import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert as RNAlert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share as RNShare,
  BackHandler,
  useColorScheme,
} from 'react-native';
import { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';

import { initAds, AdBanner } from './ads';
import { noteSessionSavedAndMaybeRequestReview } from './review';

// --- Web 対応シム ---
// react-native-web には Alert / Share が無いため、Web では
// ブラウザ標準の window.alert / window.confirm / Web Share API に差し替える。
// ネイティブ（iOS/Android）ではこれまで通り React Native の実装を使う。
const IS_WEB = Platform.OS === 'web';

// Alert.alert(title, message, buttons?) の Web 実装
function webAlert(title, message, buttons) {
  const text = [title, message].filter(Boolean).join('\n\n');
  // ボタンが無い/1つ＝お知らせ → window.alert
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    const only = buttons && buttons[0];
    if (only && only.onPress) only.onPress();
    return;
  }
  // 「キャンセル＋実行」＝確認 → window.confirm
  const cancelBtn = buttons.find((b) => b.style === 'cancel');
  const confirmBtn = buttons.find((b) => b.style !== 'cancel') || buttons[buttons.length - 1];
  if (window.confirm(text)) {
    if (confirmBtn && confirmBtn.onPress) confirmBtn.onPress();
  } else if (cancelBtn && cancelBtn.onPress) {
    cancelBtn.onPress();
  }
}

// Share.share({ message }) の Web 実装（Web Share API → 非対応時はクリップボード）
async function webShare({ message }) {
  try {
    if (navigator.share) {
      await navigator.share({ text: message });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // ユーザーがキャンセルしただけ
    // それ以外はクリップボードへフォールバック
  }
  try {
    await navigator.clipboard.writeText(message);
    window.alert('共有内容をクリップボードにコピーしました');
  } catch (_) {
    window.alert(message);
  }
}

const Alert = IS_WEB ? { alert: webAlert } : RNAlert;
const Share = IS_WEB ? { share: webShare } : RNShare;

// ローカルストレージのキー
const STORAGE_KEY = '@rotation_sessions_v3';
const SETTINGS_KEY = '@rotation_settings_v1';
const NAMES_KEY = '@rotation_names_v1';
const ONBOARDING_KEY = '@rotation_onboarding_v1'; // 初回案内を表示済みなら '1'
const PLAYING_KEY = '@rotation_playing_v1'; // 遊技中の途中経過（保存・中断したら消す）

// 設定のデフォルト値
const DEFAULT_SETTINGS = {
  rateBalls: 250,
  ballButtons: [125, 250, 1000],
  rotationButtons: [1, 10, 100],
  theme: 'auto', // 'auto' | 'light' | 'dark'
};

// 設定画面の表示モード選択肢
const THEME_OPTIONS = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

// 画面の識別子（タイプミス防止のため定数化）
const SCREEN = {
  HOME: 'home',
  SETUP: 'setup',
  PLAYING: 'playing',
  RESET: 'reset',
  SETTINGS: 'settings',
  DETAIL: 'detail',
  EDIT: 'edit',
};

// カラーパレット（色はすべてここで一元管理する）
// ライト／ダークの2セットを持ち、画面ではテーマ経由（colors.xxx）で参照する。
const THEMES = {
  light: {
    primary: '#0A5BFF',        // メインの青（強調値・主ボタン）
    primaryButton: '#0A5BFF',  // 主ボタンの塗り
    primaryDeep: '#0A4FD6',    // 薄い青地の上に載せる青文字
    primaryTint: '#E6EEFF',    // 薄い青地（加算ボタン）
    background: '#F4F5F9',     // 画面全体の背景
    surface: '#FFFFFF',        // カード・入力欄
    surfaceSunken: '#F4F5F9',  // カードの中の入力欄・減算ボタン
    border: '#E3E6EE',         // 枠線（最小限）
    divider: '#EEF0F5',        // 区切り線
    textDark: '#111827',       // 見出し・数値の強調
    textBody: '#3B4252',       // 本文テキスト
    textGray: '#5B6478',       // ラベル
    textMuted: '#8A92A6',      // 補助テキスト・プレースホルダー
    danger: '#E5484D',         // 削除など危険な操作の赤
    dangerTint: '#FDECEC',     // 赤の薄い地
    onPrimary: '#FFFFFF',      // 青の上の文字
    shadow: true,              // 面の高さを影で出すか
  },
  dark: {
    primary: '#5A93FF',
    primaryButton: '#2F6FFF',
    primaryDeep: '#9DBEFF',
    primaryTint: '#1F3560',
    background: '#0F1420',
    surface: '#171D2C',
    surfaceSunken: '#222A3C',
    border: '#2A3346',
    divider: '#262E42',
    textDark: '#F1F3F8',
    textBody: '#C5CBD8',
    textGray: '#A0A8BA',
    textMuted: '#7C8598',
    danger: '#FF6B6B',
    dangerTint: '#3A1F24',
    onPrimary: '#FFFFFF',
    shadow: false,
  },
};

// テーマ（colors と styles）を再利用コンポーネントへ渡すための入れ物
const ThemeContext = createContext(null);

// 画面全体で使う見た目の基準値
const SPACING = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
};

const TYPE_SIZE = {
  caption: 12,
  label: 13,
  body: 16,
  metric: 18,
  title: 20,
  emphasis: 26,
  input: 26,
  cardRate: 40,
  liveRate: 52,
};

const RADIUS = {
  control: 14,
  surface: 20,
};

// 押したときの反応をすべての操作で統一する
const BUTTON_ACTIVE_OPACITY = 0.7;

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // 現在の画面（値は SCREEN 定数を参照）
  const [screen, setScreen] = useState(SCREEN.HOME);
  // 保存済みセッション一覧
  const [sessions, setSessions] = useState([]);
  // 記録の読み込みに成功したか。失敗したまま書き込むと過去の記録を空で上書きしてしまう
  const sessionsLoaded = useRef(false);

  // グローバル設定
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // 設定画面の編集中ドラフト
  const [draftRateBalls, setDraftRateBalls] = useState('250');
  const [draftBallButtons, setDraftBallButtons] = useState(['125', '250', '1000']);
  const [draftRotationButtons, setDraftRotationButtons] = useState(['1', '10', '100']);
  const [draftTheme, setDraftTheme] = useState('auto');

  // 表示モード。設定が「自動」なら端末の設定に従う
  const systemScheme = useColorScheme();
  const scheme =
    settings.theme === 'light' || settings.theme === 'dark'
      ? settings.theme
      : (systemScheme === 'dark' ? 'dark' : 'light');
  const colors = THEMES[scheme];
  const styles = useMemo(() => makeStyles(colors), [scheme]);
  const theme = useMemo(() => ({ colors, styles }), [styles]);
  const statusBarStyle = scheme === 'dark' ? 'light' : 'dark';
  // 各画面の JSX をテーマで包む（再利用コンポーネントが colors / styles を受け取れるようにする）
  const withTheme = (node) => (
    <ThemeContext.Provider value={theme}>{node}</ThemeContext.Provider>
  );

  // 詳細画面
  const [detailSession, setDetailSession] = useState(null);

  // 編集画面
  const [editDraft, setEditDraft] = useState({});
  const updateEditDraft = (key, value) => setEditDraft((prev) => ({ ...prev, [key]: value }));

  // 機種名・店舗名の入力履歴
  const [machineNameHistory, setMachineNameHistory] = useState([]);
  const [storeNameHistory, setStoreNameHistory] = useState([]);
  const [showMachineSuggestions, setShowMachineSuggestions] = useState(false);
  const [showStoreSuggestions, setShowStoreSuggestions] = useState(false);

  // 台情報入力（setup画面）
  const [machineName, setMachineName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [machineNumber, setMachineNumber] = useState('');
  const [startRotation, setStartRotation] = useState('');
  const [memo, setMemo] = useState('');

  // 遊技中の記録（playing画面）
  const [ballsUsed, setBallsUsed] = useState('');
  const [endRotation, setEndRotation] = useState(''); // 終了時の台の回転数（台の表示値）
  const [startTime, setStartTime] = useState(null);

  // リセット関連
  const [accumulatedRotations, setAccumulatedRotations] = useState(0); // リセット前の累積回転数
  const [accumulatedBalls, setAccumulatedBalls] = useState(0);         // リセット前の累積使用玉数
  const [newResetRotation, setNewResetRotation] = useState('');        // リセット後の開始回転数入力
  // 「続きから遊技」で始めたときの元の記録の id（保存時にその記録を置き換える）
  const [continueId, setContinueId] = useState(null);

  // 初回起動の案内を出すか（null = まだ判定中）
  const [showOnboarding, setShowOnboarding] = useState(null);

  // アプリ起動時にデータ・設定・履歴を読み込む
  useEffect(() => {
    loadSettings();
    loadNames();
    // 広告の下準備。使えない環境（Expo Go / ブラウザ）では何も起きない
    initAds();
    // 記録を読み込んでから、初回案内を出すか決める
    (async () => {
      const loaded = await loadSessions();
      await decideOnboarding(loaded);
    })();
    // 遊技の途中でアプリが終了されていたら、遊技中画面へ戻す
    restorePlaying();
  }, []);

  // 遊技中の値が変わるたびに途中経過を書き出す
  // （OS にアプリを終了されても、次の起動で続きから再開できるようにする）
  useEffect(() => {
    if (screen !== SCREEN.PLAYING && screen !== SCREEN.RESET) return;
    AsyncStorage.setItem(
      PLAYING_KEY,
      JSON.stringify({
        machineName,
        storeName,
        machineNumber,
        startRotation,
        memo,
        ballsUsed,
        endRotation,
        startTime: startTime ? startTime.toISOString() : null,
        accumulatedRotations,
        accumulatedBalls,
        continueId,
      })
    ).catch(() => {});
  }, [
    screen, machineName, storeName, machineNumber, startRotation, memo,
    ballsUsed, endRotation, startTime, accumulatedRotations, accumulatedBalls,
    continueId,
  ]);

  // Android の戻る操作を、各画面のヘッダーの「戻る」と同じ動きにする
  // （ホームでは何もせず、通常どおりアプリを抜ける）
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === SCREEN.HOME) return false;
      if (screen === SCREEN.PLAYING) {
        handleAbort(); // 中断の確認を出す
      } else if (screen === SCREEN.RESET) {
        setScreen(SCREEN.PLAYING);
      } else if (screen === SCREEN.SETUP) {
        resetForm();
        setScreen(SCREEN.HOME);
      } else {
        setScreen(SCREEN.HOME);
      }
      return true;
    });
    return () => sub.remove();
  }, [screen]);

  // 遊技中の途中経過を消す（保存・中断のとき）
  const clearPlaying = () => AsyncStorage.removeItem(PLAYING_KEY).catch(() => {});

  // 途中経過が残っていれば読み込んで遊技中画面へ復帰する
  const restorePlaying = async () => {
    try {
      const data = await AsyncStorage.getItem(PLAYING_KEY);
      if (data === null) return;
      const p = JSON.parse(data);
      const text = (v) => (typeof v === 'string' ? v : '');
      const count = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
      // 開始回転数がなければ再開できないので捨てる
      if (!p || isNaN(parseInt(p.startRotation, 10))) {
        clearPlaying();
        return;
      }
      const restoredStart = p.startTime ? new Date(p.startTime) : null;
      setMachineName(text(p.machineName));
      setStoreName(text(p.storeName));
      setMachineNumber(text(p.machineNumber));
      setStartRotation(text(p.startRotation));
      setMemo(text(p.memo));
      setBallsUsed(text(p.ballsUsed));
      setEndRotation(text(p.endRotation));
      setStartTime(restoredStart && !isNaN(restoredStart.getTime()) ? restoredStart : null);
      setAccumulatedRotations(count(p.accumulatedRotations));
      setAccumulatedBalls(count(p.accumulatedBalls));
      setContinueId(typeof p.continueId === 'string' ? p.continueId : null);
      setScreen(SCREEN.PLAYING);
    } catch (_) {
      // 読めない途中経過は無視してホームから始める
    }
  };

  // 初回案内は「表示済みフラグがなく、記録も1件もない」ときだけ出す。
  // アップデートで初めてこの判定を通る既存ユーザーは記録があるので出さない。
  const decideOnboarding = async (loadedSessions) => {
    try {
      const seen = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (seen !== null) {
        setShowOnboarding(false);
        return;
      }
      if (loadedSessions.length > 0) {
        await AsyncStorage.setItem(ONBOARDING_KEY, '1');
        setShowOnboarding(false);
        return;
      }
      setShowOnboarding(true);
    } catch (_) {
      setShowOnboarding(false);
    }
  };

  // 初回案内を閉じる（二度と出さない）
  const handleFinishOnboarding = async () => {
    setShowOnboarding(false);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch (_) {}
  };

  // AsyncStorageから設定を読み込む
  const loadSettings = async () => {
    try {
      const data = await AsyncStorage.getItem(SETTINGS_KEY);
      if (data !== null) {
        // 古い保存データに新しい項目（theme など）がなくても困らないよう、初期値に重ねる
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(data) });
      }
    } catch (_) {
      // 読み込み失敗時はデフォルト値のまま
    }
  };

  // 機種名・店舗名の履歴を読み込む
  const loadNames = async () => {
    try {
      const data = await AsyncStorage.getItem(NAMES_KEY);
      if (data !== null) {
        const { machineNames = [], storeNames = [] } = JSON.parse(data);
        setMachineNameHistory(machineNames);
        setStoreNameHistory(storeNames);
      }
    } catch (_) {}
  };

  // 機種名・店舗名の履歴に追加して保存する（重複除去・最新順・最大30件）
  const saveNameHistory = async (newMachineName, newStoreName) => {
    const addToHistory = (history, newValue) => {
      if (!newValue) return history;
      return [newValue, ...history.filter((v) => v !== newValue)].slice(0, 30);
    };
    const updatedMachineNames = addToHistory(machineNameHistory, newMachineName);
    const updatedStoreNames = addToHistory(storeNameHistory, newStoreName);
    setMachineNameHistory(updatedMachineNames);
    setStoreNameHistory(updatedStoreNames);
    try {
      await AsyncStorage.setItem(
        NAMES_KEY,
        JSON.stringify({ machineNames: updatedMachineNames, storeNames: updatedStoreNames })
      );
    } catch (_) {}
  };

  // AsyncStorageからデータを読み込む
  // 読み込んだ配列を返す（起動時の初回案内の判定に使う）
  const loadSessions = async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = data !== null ? JSON.parse(data) : [];
      if (!Array.isArray(parsed)) throw new Error('記録の形が不正');
      sessionsLoaded.current = true;
      setSessions(parsed);
      return parsed;
    } catch (error) {
      Alert.alert('エラー', 'データの読み込みに失敗しました');
    }
    return [];
  };

  // 書き込みの土台にする記録一覧を返す。
  // 起動時の読み込みに失敗していた場合は、空の一覧で上書きしないよう保存先を読み直す。
  // 読み直しも失敗したら null を返す（呼び出し側は書き込まない）。
  const getSessionsForWrite = async () => {
    if (sessionsLoaded.current) return sessions;
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = data !== null ? JSON.parse(data) : [];
      if (!Array.isArray(parsed)) throw new Error('記録の形が不正');
      sessionsLoaded.current = true;
      setSessions(parsed);
      return parsed;
    } catch (_) {
      Alert.alert('エラー', '過去の記録を読み込めないため、保存を中止しました');
      return null;
    }
  };

  // フォームを全リセット
  const resetForm = () => {
    setMachineName('');
    setStoreName('');
    setMachineNumber('');
    setStartRotation('');
    setMemo('');
    setBallsUsed('');
    setEndRotation('');
    setStartTime(null);
    setAccumulatedRotations(0);
    setAccumulatedBalls(0);
    setNewResetRotation('');
    setContinueId(null);
  };

  // 遊技スタート（setup → playing）
  const handleStartSession = () => {
    if (!startRotation.trim() || isNaN(Number(startRotation))) {
      Alert.alert('入力エラー', '開始時の回転数を入力してください');
      return;
    }
    setShowMachineSuggestions(false);
    setShowStoreSuggestions(false);
    setStartTime(new Date());
    setBallsUsed('');
    setEndRotation(''); // 空欄スタート（プレースホルダーに開始回転数を表示）
    setScreen(SCREEN.PLAYING);
  };

  // 遊技終了・保存（playing → home）
  const handleEndSession = async () => {
    const ballsNum = parseInt(ballsUsed, 10);
    const endRotationNum = parseInt(endRotation, 10);
    const startRotationNum = parseInt(startRotation, 10);

    if (!ballsUsed.trim() || isNaN(ballsNum) || ballsNum <= 0) {
      Alert.alert('入力エラー', '使用玉数を入力してください');
      return;
    }
    if (!endRotation.trim() || isNaN(endRotationNum)) {
      Alert.alert('入力エラー', '現在の回転数を入力してください');
      return;
    }
    if (endRotationNum < startRotationNum) {
      Alert.alert('入力エラー', '現在の回転数は開始時の値より大きい値を入力してください');
      return;
    }

    // 合計回転数・合計玉数（累積 + 現セグメント）
    const rotationsNum = accumulatedRotations + Math.max(0, endRotationNum - startRotationNum);
    const totalBallsNum = accumulatedBalls + ballsNum;

    if (rotationsNum <= 0) {
      Alert.alert('入力エラー', '回転数が0回です。回転していない場合は中断してください');
      return;
    }

    const base = await getSessionsForWrite();
    if (base === null) return;

    const now = new Date();
    const today = now.toLocaleDateString('ja-JP');
    // 「続きから遊技」で始めた場合は元の記録を置き換える（同じ id のまま）
    const original = continueId ? base.find((s) => s.id === continueId) : null;
    const newStartTime = startTime
      ? startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      : '--';
    const newSession = {
      id: original ? original.id : Date.now().toString(),
      date: today,
      // 同じ日の続きなら、元の記録の開始時刻を残す
      startTime: original && original.date === today ? original.startTime : newStartTime,
      endTime: now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      machineName: machineName.trim(),
      storeName: storeName.trim(),
      machineNumber: machineNumber.trim(),
      startRotation: startRotationNum,
      endRotation: endRotationNum,
      rotations: rotationsNum,           // 合計回転数（リセット累積込み）
      ballsUsed: totalBallsNum,          // 合計使用玉数（リセット累積込み）
      memo: memo.trim(),                  // メモ（任意・200文字以内）
      // rotationRate は表示時に動的に計算するため保存しない
    };

    try {
      const updatedSessions = [
        newSession,
        ...base.filter((s) => s.id !== newSession.id),
      ];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
      setSessions(updatedSessions);
      await saveNameHistory(machineName.trim(), storeName.trim());
      clearPlaying();
      resetForm();
      setScreen(SCREEN.HOME);
      // ホームに戻ってから、条件がそろえばレビュー依頼を出す（3回目の保存で一度だけ）
      setTimeout(noteSessionSavedAndMaybeRequestReview, 600);
    } catch (error) {
      Alert.alert('エラー', 'データの保存に失敗しました');
    }
  };

  // 設定画面を開く（現在の設定値をドラフトにコピー）
  const handleOpenSettings = () => {
    setDraftRateBalls(String(settings.rateBalls));
    setDraftBallButtons(settings.ballButtons.map(String));
    setDraftRotationButtons(settings.rotationButtons.map(String));
    setDraftTheme(settings.theme || 'auto');
    setScreen(SCREEN.SETTINGS);
  };

  // 設定を保存する
  const handleSaveSettings = async () => {
    const rateBalls = parseInt(draftRateBalls, 10);
    const ballButtons = draftBallButtons.map((v) => parseInt(v, 10));
    const rotationButtons = draftRotationButtons.map((v) => parseInt(v, 10));

    if (isNaN(rateBalls) || rateBalls <= 0) {
      Alert.alert('入力エラー', '基準玉数を正しく入力してください');
      return;
    }
    if (ballButtons.some((v) => isNaN(v) || v <= 0)) {
      Alert.alert('入力エラー', '使用玉数ボタンの値を正しく入力してください');
      return;
    }
    if (rotationButtons.some((v) => isNaN(v) || v <= 0)) {
      Alert.alert('入力エラー', '回転数ボタンの値を正しく入力してください');
      return;
    }

    const newSettings = { rateBalls, ballButtons, rotationButtons, theme: draftTheme };
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
      setSettings(newSettings);
      setScreen(SCREEN.HOME);
    } catch (_) {
      Alert.alert('エラー', '設定の保存に失敗しました');
    }
  };

  // 編集画面を開く（日付・時刻を分割してドラフトにセット）
  const handleOpenEdit = (item) => {
    const [year = '', month = '', day = ''] = (item.date || '').split('/');
    const [sh = '', sm = ''] = (item.startTime || '').split(':');
    const [eh = '', em = ''] = (item.endTime || '').split(':');
    setEditDraft({
      machineName: item.machineName || '',
      storeName: item.storeName || '',
      machineNumber: item.machineNumber || '',
      memo: item.memo || '',
      dateYear: year,
      dateMonth: month,
      dateDay: day,
      startHour: sh,
      startMinute: sm,
      endHour: eh,
      endMinute: em,
      id: item.id,
    });
    setScreen(SCREEN.EDIT);
  };

  // 編集内容を保存する
  const handleSaveEdit = async () => {
    // 日付の検証
    const year = parseInt(editDraft.dateYear, 10);
    const month = parseInt(editDraft.dateMonth, 10);
    const day = parseInt(editDraft.dateDay, 10);
    if (isNaN(year) || year < 1900 || year > 2999) {
      Alert.alert('入力エラー', '年を正しく入力してください');
      return;
    }
    if (isNaN(month) || month < 1 || month > 12) {
      Alert.alert('入力エラー', '月を正しく入力してください');
      return;
    }
    if (isNaN(day) || day < 1 || day > 31) {
      Alert.alert('入力エラー', '日を正しく入力してください');
      return;
    }
    // 存在しない日付（2月31日、4月31日、うるう年でない2/29 など）を弾く
    const checkDate = new Date(year, month - 1, day);
    if (
      checkDate.getFullYear() !== year ||
      checkDate.getMonth() !== month - 1 ||
      checkDate.getDate() !== day
    ) {
      Alert.alert('入力エラー', '存在しない日付です');
      return;
    }
    // 時刻の検証
    const sh = parseInt(editDraft.startHour, 10);
    const sm = parseInt(editDraft.startMinute, 10);
    const eh = parseInt(editDraft.endHour, 10);
    const em = parseInt(editDraft.endMinute, 10);
    const validTime = (h, m) => !isNaN(h) && h >= 0 && h <= 23 && !isNaN(m) && m >= 0 && m <= 59;
    if (!validTime(sh, sm)) {
      Alert.alert('入力エラー', '開始時刻を正しく入力してください');
      return;
    }
    if (!validTime(eh, em)) {
      Alert.alert('入力エラー', '終了時刻を正しく入力してください');
      return;
    }
    // 終了時刻が開始時刻より前の場合は、日付をまたいだ記録（翌日の終了）として受け付ける

    const pad = (s) => String(s || '').padStart(2, '0');
    const date = `${year}/${month}/${day}`;
    const startTime = `${pad(sh)}:${pad(sm)}`;
    const endTime = `${pad(eh)}:${pad(em)}`;

    const base = await getSessionsForWrite();
    if (base === null) return;
    const updated = base.map((s) =>
      s.id === editDraft.id
        ? {
            ...s,
            machineName: editDraft.machineName.trim(),
            storeName: editDraft.storeName.trim(),
            machineNumber: editDraft.machineNumber.trim(),
            memo: (editDraft.memo || '').trim(),
            date,
            startTime,
            endTime,
          }
        : s
    );
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSessions(updated);
      setScreen(SCREEN.HOME);
    } catch (_) {
      Alert.alert('エラー', 'データの保存に失敗しました');
    }
  };

  // 保存済みセッションから台情報・累積データを引き継いで続行
  const handleContinueSession = (item) => {
    const rotation = String(item.endRotation);
    resetForm();
    setMachineName(item.machineName || '');
    setStoreName(item.storeName || '');
    setMachineNumber(item.machineNumber || '');
    setMemo(item.memo || ''); // 元の記録を置き換えるのでメモも引き継ぐ
    setStartRotation(rotation);
    setEndRotation(''); // 空欄スタート（プレースホルダーに引き継ぎ回転数を表示）
    setStartTime(new Date());
    setAccumulatedRotations(item.rotations);
    setAccumulatedBalls(item.ballsUsed);
    setContinueId(item.id);
    setScreen(SCREEN.PLAYING);
  };

  // 共有テキストを組み立てる（メモは含めない）
  const buildShareText = (item) => {
    const lines = ['【遊技記録】'];
    if (item.date) lines.push(`日付: ${item.date}`);
    if (item.storeName) lines.push(`店舗: ${item.storeName}`);
    const machine = `${item.machineName || ''}${item.machineNumber ? `（${item.machineNumber}番台）` : ''}`;
    if (machine) lines.push(`機種: ${machine}`);
    if (item.startTime && item.endTime && item.startTime !== '--') {
      const dur = calcDuration(item.startTime, item.endTime);
      lines.push(`時間: ${item.startTime} - ${item.endTime}${dur ? `（${dur}）` : ''}`);
    }
    lines.push('');
    lines.push(`総回転数: ${item.rotations.toLocaleString()}`);
    lines.push(`総使用玉数: ${item.ballsUsed.toLocaleString()}`);
    const rate = item.ballsUsed > 0
      ? ((item.rotations / item.ballsUsed) * settings.rateBalls).toFixed(1)
      : '--';
    lines.push(`${settings.rateBalls}玉あたり回転数: ${rate}`);
    lines.push('');
    lines.push('#パチカウント');
    return lines.join('\n');
  };

  // セッションを共有する
  const handleShareSession = async (item) => {
    try {
      await Share.share({ message: buildShareText(item) });
    } catch (_) {
      Alert.alert('エラー', '共有に失敗しました');
    }
  };

  // セッション削除
  const handleDeleteSession = (id) => {
    Alert.alert(
      '記録を削除しますか？',
      'この操作は元に戻せません',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: async () => {
            const base = await getSessionsForWrite();
            if (base === null) return;
            const updated = base.filter((s) => s.id !== id);
            try {
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
              setSessions(updated);
              setScreen(SCREEN.HOME);
            } catch (error) {
              Alert.alert('エラー', 'データの削除に失敗しました');
            }
          },
        },
      ]
    );
  };

  // すべての記録を削除する（設定・入力履歴は残す）
  const handleClearSessions = () => {
    Alert.alert(
      'すべての記録を削除しますか？',
      'この操作は元に戻せません。設定は保持されます。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'すべて削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem(STORAGE_KEY);
              sessionsLoaded.current = true; // 空にした状態が正しい中身になる
              setSessions([]);
              setScreen(SCREEN.HOME);
            } catch (_) {
              Alert.alert('エラー', 'データの削除に失敗しました');
            }
          },
        },
      ]
    );
  };

  // 中断（保存しないで戻る）
  const handleAbort = () => {
    Alert.alert(
      '遊技を中断しますか？',
      'この遊技のデータは保存されません',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '中断する',
          style: 'destructive',
          onPress: () => {
            clearPlaying();
            resetForm();
            setScreen(SCREEN.HOME);
          },
        },
      ]
    );
  };

  // 現在の回転数を加減算する（マイナス時は開始回転数を下限にする）
  const addToEndRotation = (amount) => {
    // parseInt("0") は 0（falsy）になるため || は使わず isNaN で判定する
    const parsedEnd = parseInt(endRotation, 10);
    const parsedStart = parseInt(startRotation, 10);
    const current = !isNaN(parsedEnd) ? parsedEnd : (!isNaN(parsedStart) ? parsedStart : 0);
    const floor = !isNaN(parsedStart) ? parsedStart : 0;
    setEndRotation(String(Math.max(floor, current + amount)));
  };

  // 使用玉数を加減算する（マイナス時は0を下限にする）
  const addToBallsUsed = (amount) => {
    const parsed = parseInt(ballsUsed, 10);
    const current = !isNaN(parsed) ? parsed : 0;
    setBallsUsed(String(Math.max(0, current + amount)));
  };

  // リセット画面を開く
  const handleOpenReset = () => {
    setNewResetRotation('');
    setScreen(SCREEN.RESET);
  };

  // リセット確定：現セグメントの回転数を累積して新しい開始回転数をセット
  const handleConfirmReset = () => {
    if (!newResetRotation.trim() || isNaN(Number(newResetRotation))) {
      Alert.alert('入力エラー', 'リセット後の回転数を入力してください');
      return;
    }
    // ここまでのセグメントの回転数・玉数を累積に加算
    // endRotation が空欄（parseInt が NaN）でも累積を壊さないよう isNaN で判定する
    const parsedEnd = parseInt(endRotation, 10);
    const parsedStart = parseInt(startRotation, 10);
    const segmentRotations =
      !isNaN(parsedEnd) && !isNaN(parsedStart)
        ? Math.max(0, parsedEnd - parsedStart)
        : 0;
    const segmentBalls = Math.max(0, parseInt(ballsUsed, 10) || 0);
    setAccumulatedRotations((prev) => prev + segmentRotations);
    setAccumulatedBalls((prev) => prev + segmentBalls);

    // 新しい開始回転数で続行・現在の回転数は空欄・使用玉数の表示は0にリセット
    setStartRotation(newResetRotation);
    setEndRotation(''); // 空欄スタート（プレースホルダーにリセット後の回転数を表示）
    setBallsUsed('0');
    setNewResetRotation('');
    setScreen(SCREEN.PLAYING);
  };

  // 開始時刻〜終了時刻から所要時間を計算（"HH:MM" 文字列）
  const calcDuration = (start, end) => {
    if (!start || !end || start === '--' || end === '--') return '';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some(isNaN)) return '';
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    // 終了が開始より前なら翌日とみなす（22:00〜0:30 など）
    if (mins < 0) mins += 24 * 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}時間${m}分`;
  };

  // 累積込みの合計回転数を計算するヘルパー
  const calcTotalRotations = () => {
    const end = parseFloat(endRotation);
    const start = parseFloat(startRotation);
    const currentSegment = !isNaN(end) && end >= start ? end - start : 0;
    return accumulatedRotations + currentSegment;
  };

  // 遊技中のリアルタイム回転率計算（リセット累積込みの総玉数・総回転数で計算）
  const calcRotationRate = () => {
    const totalBalls = accumulatedBalls + (parseFloat(ballsUsed) || 0);
    const totalRotations = calcTotalRotations();
    if (totalBalls > 0 && totalRotations > 0) {
      return ((totalRotations / totalBalls) * settings.rateBalls).toFixed(1);
    }
    return '--';
  };

  // 入力履歴の候補リストを表示する（機種名・店舗名で共通利用）
  // visible: 表示フラグ / history: 履歴配列 / value: 現在の入力値
  // onSelect: 候補選択時の処理 / onClose: リストを閉じる処理
  const renderSuggestions = (visible, history, value, onSelect, onClose) => {
    if (!visible) return null;
    const matches = history.filter((n) =>
      n.toLowerCase().includes(value.toLowerCase())
    );
    if (matches.length === 0) return null;
    return (
      <View style={styles.suggestionsContainer}>
        {matches.map((name, i) => (
          <TouchableOpacity
            key={i}
            style={styles.suggestionItem}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={() => { onSelect(name); onClose(); }}
          >
            <Text style={styles.suggestionText}>{name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // ========================================
  // ホーム画面
  // ========================================
  if (!fontsLoaded) return null;

  // ========================================
  // 初回起動の案内（1画面・一度だけ）
  // ========================================
  if (showOnboarding && screen === SCREEN.HOME) {
    const steps = [
      { n: '1', text: '台の回転数を入力して遊技開始' },
      { n: '2', text: '使った玉数と回転数を入れると回転率を計算' },
      { n: '3', text: '保存すると記録が一覧に並ぶ' },
    ];
    return withTheme(
      <View style={styles.container}>
        <StatusBar style={statusBarStyle} />
        <View style={styles.onboardingBody}>
          <Text style={styles.onboardingTitle}>パチカウント</Text>
          <Text style={styles.onboardingSubtitle}>パチンコの回転数と回転率を記録するアプリ</Text>
          <View style={styles.onboardingCard}>
            {steps.map((step, i) => (
              <View
                key={step.n}
                style={[styles.onboardingStep, i < steps.length - 1 && styles.onboardingStepBorder]}
              >
                <View style={styles.onboardingBadge}>
                  <Text style={styles.onboardingBadgeText}>{step.n}</Text>
                </View>
                <Text style={styles.onboardingStepText}>{step.text}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.homeFooter}>
          <AppButton label="はじめる" onPress={handleFinishOnboarding} />
        </View>
      </View>
    );
  }

  if (screen === SCREEN.HOME) {
    return withTheme(
      <View style={styles.container}>
        <StatusBar style={statusBarStyle} />
        <ScreenHeader
          title="パチカウント"
          rightLabel="設定"
          onRightPress={handleOpenSettings}
        />

        {sessions.length === 0 ? (
          // 記録がない場合
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>記録がありません</Text>
          </View>
        ) : (
          // 記録一覧
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.sessionCard}
                activeOpacity={BUTTON_ACTIVE_OPACITY}
                onPress={() => { setDetailSession(item); setScreen(SCREEN.DETAIL); }}
              >
                {/* ヒーロー：回転率を主役表示 */}
                <View style={styles.cardHero}>
                  <View style={styles.cardHeroLeft}>
                    <Text style={styles.cardRateValue}>
                      {item.ballsUsed > 0
                        ? ((item.rotations / item.ballsUsed) * settings.rateBalls).toFixed(1)
                        : '--'}
                    </Text>
                    <Text style={styles.cardRateLabel}>{settings.rateBalls}玉あたり</Text>
                  </View>
                  <View style={styles.cardHeroRight}>
                    <Text style={styles.cardDate}>{item.date}</Text>
                    <Text style={styles.cardTime}>{item.startTime} – {item.endTime}</Text>
                  </View>
                </View>

                {/* 区切り線 */}
                <View style={styles.cardDivider} />

                {/* 台情報 */}
                {item.storeName ? (
                  <Text style={styles.cardStore}>{item.storeName}</Text>
                ) : null}
                <Text style={styles.cardMachine}>
                  {item.machineName || '機種未入力'}
                  {item.machineNumber ? `（${item.machineNumber}番台）` : ''}
                </Text>

                {/* 集計値 */}
                <View style={styles.cardCountsRow}>
                  <Text style={styles.cardCount}>
                    <Text style={styles.numberMedium}>{item.rotations.toLocaleString()}</Text> 回転
                  </Text>
                  <Text style={styles.cardCount}>
                    <Text style={styles.numberMedium}>{item.ballsUsed.toLocaleString()}</Text> 玉
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* バナー広告（記録一覧の下・遊技開始ボタンの上） */}
        <AdBanner
          borderColor={colors.divider}
          backgroundColor={colors.background}
          textColor={colors.textGray}
        />

        {/* 遊技開始ボタン（端末下部の操作バーと重ならないよう余白を確保） */}
        <View style={styles.homeFooter}>
          <AppButton label="遊技開始" onPress={() => setScreen(SCREEN.SETUP)} />
        </View>
      </View>
    );
  }

  // ========================================
  // 台情報入力画面（setup）
  // ========================================
  if (screen === SCREEN.SETUP) {
    return withTheme(
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style={statusBarStyle} />
        <ScreenHeader
          title="台情報を入力"
          leftLabel="戻る"
          onLeftPress={() => { resetForm(); setScreen(SCREEN.HOME); }}
        />
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* 開始時の回転数（必須・最上部で目立たせる） */}
          <View style={styles.startRotationBlock}>
            <Text style={styles.startRotationLabel}>
              開始時の回転数 <Text style={styles.required}>必須</Text>
            </Text>
            <TextInput
              style={styles.inputLarge}
              value={startRotation}
              onChangeText={setStartRotation}
              keyboardType="numeric"
              maxLength={7}
              returnKeyType="done"
            />
          </View>

          {/* 機種名（任意）+ 履歴候補 */}
          <Text style={styles.label}>機種名</Text>
          <TextInput
            style={styles.input}
            value={machineName}
            onChangeText={(text) => { setMachineName(text); setShowMachineSuggestions(true); }}
            onFocus={() => setShowMachineSuggestions(true)}
            onBlur={() => setTimeout(() => setShowMachineSuggestions(false), 200)}
            maxLength={50}
            returnKeyType="next"
          />
          {renderSuggestions(
            showMachineSuggestions, machineNameHistory, machineName,
            setMachineName, () => setShowMachineSuggestions(false)
          )}

          {/* 店舗名（任意）+ 履歴候補 */}
          <Text style={styles.label}>店舗名</Text>
          <TextInput
            style={styles.input}
            value={storeName}
            onChangeText={(text) => { setStoreName(text); setShowStoreSuggestions(true); }}
            onFocus={() => setShowStoreSuggestions(true)}
            onBlur={() => setTimeout(() => setShowStoreSuggestions(false), 200)}
            maxLength={50}
            returnKeyType="next"
          />
          {renderSuggestions(
            showStoreSuggestions, storeNameHistory, storeName,
            setStoreName, () => setShowStoreSuggestions(false)
          )}

          {/* 台番号（任意） */}
          <Text style={styles.label}>台番号</Text>
          <TextInput
            style={[styles.input, styles.numberMedium]}
            value={machineNumber}
            onChangeText={setMachineNumber}
            keyboardType="numeric"
            maxLength={5}
            returnKeyType="next"
          />

          {/* メモ（任意・200文字以内） */}
          <Text style={styles.label}>メモ</Text>
          <TextInput
            style={styles.memoInput}
            value={memo}
            onChangeText={setMemo}
            multiline
            maxLength={200}
            textAlignVertical="top"
          />
          <Text style={styles.memoCounter}>{memo.length} / 200</Text>

          {/* 遊技スタートボタン */}
          <AppButton label="遊技開始" onPress={handleStartSession} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // 詳細画面（detail）
  // ========================================
  if (screen === SCREEN.DETAIL) {
    const item = detailSession;
    if (!item) {
      // 安全策: detailSession 未設定なら home へ
      setScreen(SCREEN.HOME);
      return null;
    }
    const duration = calcDuration(item.startTime, item.endTime);
    const rate = item.ballsUsed > 0
      ? ((item.rotations / item.ballsUsed) * settings.rateBalls).toFixed(1)
      : '--';

    return withTheme(
      <View style={styles.container}>
        <StatusBar style={statusBarStyle} />
        <ScreenHeader
          title="記録の詳細"
          leftLabel="戻る"
          onLeftPress={() => setScreen(SCREEN.HOME)}
        />

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* 日時 */}
          <View style={styles.detailDateBlock}>
            <Text style={styles.detailDateText}>{item.date}</Text>
            <Text style={styles.detailTimeText}>
              {item.startTime} - {item.endTime}
              {duration ? `（${duration}）` : ''}
            </Text>
          </View>

          {/* 店舗・台情報 */}
          <Text style={styles.detailSectionLabel}>店舗・台情報</Text>
          <View style={styles.detailSection}>
            <DetailRow label="店舗名" value={item.storeName || '-'} />
            <DetailRow label="機種名" value={item.machineName || '-'} />
            <DetailRow label="台番号" value={item.machineNumber || '-'} numeric />
          </View>

          {/* 遊技データ */}
          <Text style={styles.detailSectionLabel}>遊技データ</Text>
          <View style={styles.detailSection}>
            <DetailRow label="総回転数" value={item.rotations.toLocaleString()} numeric />
            <DetailRow label="総使用玉数" value={item.ballsUsed.toLocaleString()} numeric />
            <View style={styles.detailDivider} />
            <DetailRow label={`${settings.rateBalls}玉あたり回転数`} value={rate} highlight numeric />
          </View>

          {/* メモ（あれば表示） */}
          {item.memo ? (
            <>
              <Text style={styles.detailSectionLabel}>メモ</Text>
              <View style={styles.detailSection}>
                <Text style={styles.detailMemoText}>{item.memo}</Text>
              </View>
            </>
          ) : null}

          {/* アクションボタン */}
          <AppButton label="編集する" variant="outline" onPress={() => handleOpenEdit(item)} />
          <AppButton label="続きから遊技" onPress={() => handleContinueSession(item)} />
          <TouchableOpacity
            style={styles.shareButton}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={() => handleShareSession(item)}
          >
            <Text style={styles.shareButtonText}>共有する</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={() => handleDeleteSession(item.id)}
          >
            <Text style={styles.deleteButtonText}>削除する</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ========================================
  // 編集画面（edit）
  // ========================================
  if (screen === SCREEN.EDIT) {
    return withTheme(
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style={statusBarStyle} />
        <ScreenHeader
          title="記録を編集"
          leftLabel="戻る"
          onLeftPress={() => setScreen(SCREEN.HOME)}
        />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>機種名</Text>
          <TextInput style={styles.input} value={editDraft.machineName}
            onChangeText={(v) => updateEditDraft('machineName', v)}
            maxLength={50} />

          <Text style={styles.label}>店舗名</Text>
          <TextInput style={styles.input} value={editDraft.storeName}
            onChangeText={(v) => updateEditDraft('storeName', v)}
            maxLength={50} />

          <Text style={styles.label}>台番号</Text>
          <TextInput style={[styles.input, styles.numberMedium]} value={editDraft.machineNumber}
            onChangeText={(v) => updateEditDraft('machineNumber', v)}
            keyboardType="numeric"
            maxLength={5} />

          <Text style={styles.label}>メモ</Text>
          <TextInput
            style={styles.memoInput}
            value={editDraft.memo || ''}
            onChangeText={(v) => updateEditDraft('memo', v)}
            multiline
            maxLength={200}
            textAlignVertical="top"
          />
          <Text style={styles.memoCounter}>{(editDraft.memo || '').length} / 200</Text>

          <Text style={styles.label}>日付</Text>
          <View style={styles.dateRow}>
            <TextInput
              style={[styles.dateInput, styles.dateInputYear]}
              value={editDraft.dateYear}
              onChangeText={(v) => updateEditDraft('dateYear', v)}
              keyboardType="numeric"
              maxLength={4}
              placeholder="2026"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.dateSeparator}>/</Text>
            <TextInput
              style={styles.dateInput}
              value={editDraft.dateMonth}
              onChangeText={(v) => updateEditDraft('dateMonth', v)}
              keyboardType="numeric"
              maxLength={2}
              placeholder="月"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.dateSeparator}>/</Text>
            <TextInput
              style={styles.dateInput}
              value={editDraft.dateDay}
              onChangeText={(v) => updateEditDraft('dateDay', v)}
              keyboardType="numeric"
              maxLength={2}
              placeholder="日"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.editTimeRow}>
            <View style={styles.editTimeItem}>
              <Text style={styles.label}>開始時刻</Text>
              <View style={styles.timeRow}>
                <TextInput
                  style={styles.timeInput}
                  value={editDraft.startHour}
                  onChangeText={(v) => updateEditDraft('startHour', v)}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="時"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.timeSeparator}>:</Text>
                <TextInput
                  style={styles.timeInput}
                  value={editDraft.startMinute}
                  onChangeText={(v) => updateEditDraft('startMinute', v)}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="分"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>
            <View style={styles.editTimeItem}>
              <Text style={styles.label}>終了時刻</Text>
              <View style={styles.timeRow}>
                <TextInput
                  style={styles.timeInput}
                  value={editDraft.endHour}
                  onChangeText={(v) => updateEditDraft('endHour', v)}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="時"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.timeSeparator}>:</Text>
                <TextInput
                  style={styles.timeInput}
                  value={editDraft.endMinute}
                  onChangeText={(v) => updateEditDraft('endMinute', v)}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="分"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>
          </View>

          <AppButton label="保存する" onPress={handleSaveEdit} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // 設定画面（settings）
  // ========================================
  if (screen === SCREEN.SETTINGS) {
    return withTheme(
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style={statusBarStyle} />
        <ScreenHeader
          title="設定"
          leftLabel="戻る"
          onLeftPress={() => setScreen(SCREEN.HOME)}
        />
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* 基準玉数 */}
          <Text style={styles.label}>回転率の基準玉数</Text>
          <TextInput
            style={[styles.input, styles.numberMedium]}
            value={draftRateBalls}
            onChangeText={setDraftRateBalls}
            keyboardType="numeric"
            returnKeyType="done"
          />

          {/* 使用玉数ボタンの値 */}
          <Text style={styles.label}>使用玉数ボタン</Text>
          <View style={styles.settingsRow}>
            {draftBallButtons.map((val, i) => (
              <TextInput
                key={`bb${i}`}
                style={styles.settingsInput}
                value={val}
                onChangeText={(text) => {
                  const next = [...draftBallButtons];
                  next[i] = text;
                  setDraftBallButtons(next);
                }}
                keyboardType="numeric"
                returnKeyType="done"
              />
            ))}
          </View>

          {/* 回転数ボタンの値 */}
          <Text style={styles.label}>回転数ボタン</Text>
          <View style={styles.settingsRow}>
            {draftRotationButtons.map((val, i) => (
              <TextInput
                key={`rb${i}`}
                style={styles.settingsInput}
                value={val}
                onChangeText={(text) => {
                  const next = [...draftRotationButtons];
                  next[i] = text;
                  setDraftRotationButtons(next);
                }}
                keyboardType="numeric"
                returnKeyType="done"
              />
            ))}
          </View>

          {/* 表示モード */}
          <Text style={styles.label}>表示</Text>
          <View style={styles.segmentRow}>
            {THEME_OPTIONS.map((opt) => {
              const active = draftTheme === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.segment, active && styles.segmentActive]}
                  activeOpacity={BUTTON_ACTIVE_OPACITY}
                  onPress={() => setDraftTheme(opt.value)}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <AppButton label="保存する" onPress={handleSaveSettings} />
          <TouchableOpacity
            style={styles.resetDefaultButton}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={() => {
              Alert.alert(
                'デフォルトに戻しますか？',
                '設定がすべて初期値にリセットされます',
                [
                  { text: 'キャンセル', style: 'cancel' },
                  {
                    text: 'リセット',
                    onPress: () => {
                      setDraftRateBalls(String(DEFAULT_SETTINGS.rateBalls));
                      setDraftBallButtons(DEFAULT_SETTINGS.ballButtons.map(String));
                      setDraftRotationButtons(DEFAULT_SETTINGS.rotationButtons.map(String));
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.resetDefaultButtonText}>デフォルトに戻す</Text>
          </TouchableOpacity>

          {/* データ管理 */}
          <View style={styles.dataSection}>
            <Text style={styles.dataSectionLabel}>データ管理</Text>
            <TouchableOpacity
              style={styles.clearDataButton}
              activeOpacity={BUTTON_ACTIVE_OPACITY}
              onPress={handleClearSessions}
            >
              <Text style={styles.clearDataButtonText}>すべての記録を削除</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // リセット入力画面（reset）
  // ========================================
  if (screen === SCREEN.RESET) {
    const currentTotal = calcTotalRotations();
    return withTheme(
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style={statusBarStyle} />
        <ScreenHeader
          title="回転数リセット"
          leftLabel="戻る"
          onLeftPress={() => setScreen(SCREEN.PLAYING)}
        />
        <Text style={styles.subtitle}>
          ここまでの遊技回転数: <Text style={styles.numberMedium}>{currentTotal.toLocaleString()}</Text> 回転
        </Text>

        <Text style={styles.label}>リセット後の回転数</Text>
        <TextInput
          style={styles.inputLarge}
          value={newResetRotation}
          onChangeText={setNewResetRotation}
          keyboardType="numeric"
          maxLength={7}
          autoFocus
        />

        <AppButton label="継続する" onPress={handleConfirmReset} />
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // 遊技中画面（playing）
  // 上のヘッダーに「中断」「保存」、本体は回転率＋入力カード2枚＋リセット
  // ========================================
  const renderCounterCard = (label, value, onChange, placeholder, buttons, add) => (
    <View style={styles.playingCard}>
      <Text style={styles.playingLabel}>{label}</Text>
      <TextInput
        style={styles.playingInput}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        maxLength={7}
        selectTextOnFocus={true}
      />
      <View style={styles.btnRow}>
        {buttons.map((n) => (
          <TouchableOpacity
            key={`+${n}`}
            style={styles.btnIncrement}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={() => add(n)}
          >
            <Text style={styles.btnIncrementText}>+{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.btnRow}>
        {buttons.map((n) => (
          <TouchableOpacity
            key={`-${n}`}
            style={styles.btnDecrement}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={() => add(-n)}
          >
            <Text style={styles.btnDecrementText}>-{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return withTheme(
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style={statusBarStyle} />
      <ScreenHeader
        title="遊技中"
        leftLabel="中断"
        leftMuted
        onLeftPress={handleAbort}
        rightLabel="保存"
        rightVariant="pill"
        onRightPress={handleEndSession}
      />

      <ScrollView
        style={styles.playingScroll}
        contentContainerStyle={styles.playingScrollContent}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 上部: 台情報 + 玉あたり回転率 + 総計 ===== */}
        <View style={styles.rateDisplay}>
          {storeName ? (
            <Text style={styles.playingStoreName}>{storeName}</Text>
          ) : null}
          <Text style={styles.playingMachineName}>
            {machineName || '機種未入力'}
            {machineNumber ? `（${machineNumber}番台）` : ''}
          </Text>
          <Text style={styles.rateDisplayValue}>{calcRotationRate()}</Text>
          <Text style={styles.rateUnit}>回転 / {settings.rateBalls}玉</Text>

          {/* 総遊技回転数・総使用玉数の常時表示 */}
          <View style={styles.totalRow}>
            <View style={styles.totalItem}>
              <Text style={styles.totalLabel}>総回転数</Text>
              <Text style={styles.totalValue}>
                {calcTotalRotations().toLocaleString()}
              </Text>
            </View>
            <View style={styles.totalDivider} />
            <View style={styles.totalItem}>
              <Text style={styles.totalLabel}>総使用玉数</Text>
              <Text style={styles.totalValue}>
                {(accumulatedBalls + (parseInt(ballsUsed, 10) || 0)).toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* ===== 回転数カード ===== */}
        {renderCounterCard(
          '現在の回転数', endRotation, setEndRotation, startRotation || '0',
          settings.rotationButtons, addToEndRotation
        )}

        {/* ===== 使用玉数カード ===== */}
        {renderCounterCard(
          '使用玉数', ballsUsed, setBallsUsed, '0',
          settings.ballButtons, addToBallsUsed
        )}

        {/* ===== リセットして続ける ===== */}
        <TouchableOpacity
          style={styles.resetButton}
          activeOpacity={BUTTON_ACTIVE_OPACITY}
          onPress={handleOpenReset}
        >
          <Text style={styles.resetButtonText}>リセットして続ける</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ========================================
// 再利用コンポーネント
// （colors / styles は App() が ThemeContext 経由で渡す）
// ========================================

// 画面共通ヘッダー
// leftMuted: 左の文字を控えめな色にする（「中断」など）
// rightVariant="pill": 右を青い丸ボタンにする（「保存」など）
function ScreenHeader({
  title, leftLabel, leftMuted, onLeftPress, rightLabel, rightVariant, onRightPress,
}) {
  const { styles } = useContext(ThemeContext);
  return (
    <View style={styles.screenHeader}>
      <View style={styles.headerSide}>
        {leftLabel ? (
          <TouchableOpacity
            style={styles.headerAction}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={onLeftPress}
            accessibilityRole="button"
          >
            <Text style={[styles.headerActionText, leftMuted && styles.headerActionTextMuted]}>
              {leftLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={[styles.headerSide, styles.headerSideRight]}>
        {rightLabel ? (
          <TouchableOpacity
            style={rightVariant === 'pill' ? styles.headerPill : styles.headerAction}
            activeOpacity={BUTTON_ACTIVE_OPACITY}
            onPress={onRightPress}
            accessibilityRole="button"
          >
            <Text style={rightVariant === 'pill' ? styles.headerPillText : styles.headerActionText}>
              {rightLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// 共通ボタン（variant で primary / outline / secondary を切り替え）
function AppButton({ label, onPress, variant = 'primary' }) {
  const { styles } = useContext(ThemeContext);
  const buttonStyle = variant === 'primary'
    ? styles.primaryButton
    : variant === 'outline'
      ? styles.outlineButton
      : styles.secondaryButton;
  const textStyle = variant === 'primary'
    ? styles.primaryButtonText
    : variant === 'outline'
      ? styles.outlineButtonText
      : styles.secondaryButtonText;
  return (
    <TouchableOpacity
      style={buttonStyle}
      activeOpacity={BUTTON_ACTIVE_OPACITY}
      onPress={onPress}
    >
      <Text style={textStyle}>{label}</Text>
    </TouchableOpacity>
  );
}

// 詳細画面の1行（label と value の横並び。highlight=true で回転率を強調表示）
function DetailRow({ label, value, highlight, numeric = false }) {
  const { styles } = useContext(ThemeContext);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[
        styles.detailValue,
        numeric && styles.numberMedium,
        highlight && styles.detailRateValue,
      ]}>
        {value}
      </Text>
    </View>
  );
}

// ========================================
// スタイル定義
// テーマの色（C）を受け取ってスタイル一式を作る。ライト／ダークで呼び分ける
// ========================================

// 面の高さを出す影。ダークでは影が見えないので付けず、面の明るさの差で表す
const surfaceShadow = (C) => {
  if (!C.shadow) return {};
  return Platform.select({
    ios: {
      shadowColor: '#101828',
      shadowOpacity: 0.07,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 2 },
    default: { boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 6px 16px rgba(16,24,40,0.06)' },
  });
};

// 主ボタンの影（青い面を少し浮かせる）
const primaryShadow = (C) => {
  if (!C.shadow) return {};
  return Platform.select({
    ios: {
      shadowColor: C.primary,
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 3 },
    default: { boxShadow: '0 6px 16px rgba(10,91,255,0.25)' },
  });
};

function makeStyles(C) {
  // 入力欄の共通部分（背景の上に置くもの）
  const inputBase = {
    backgroundColor: C.surface,
    borderRadius: RADIUS.control,
    color: C.textDark,
    ...surfaceShadow(C),
  };
  // 数字を入れる入力欄の共通部分
  const numberInput = {
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  };

  return StyleSheet.create({
    numberMedium: {
      fontFamily: 'Inter_600SemiBold',
      fontVariant: ['tabular-nums'],
    },
    numberBold: {
      fontFamily: 'Inter_700Bold',
      fontVariant: ['tabular-nums'],
    },
    container: {
      flex: 1,
      backgroundColor: C.background,
      paddingTop: 56,
      paddingHorizontal: SPACING.md,
    },
    subtitle: {
      fontSize: TYPE_SIZE.label,
      textAlign: 'center',
      color: C.textMuted,
      marginBottom: SPACING.xl,
    },

    // ホーム: 記録なしの表示
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      fontSize: TYPE_SIZE.metric,
      color: C.textMuted,
    },
    // ホーム: 遊技開始ボタンの下部余白（ジェスチャーバー/ホームインジケーター回避）
    homeFooter: {
      paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    },

    // 初回起動の案内
    onboardingBody: {
      flex: 1,
      justifyContent: 'center',
      paddingBottom: SPACING.xl,
    },
    onboardingTitle: {
      fontSize: 32,
      fontWeight: '700',
      color: C.textDark,
      textAlign: 'center',
      letterSpacing: -0.5,
    },
    onboardingSubtitle: {
      fontSize: TYPE_SIZE.label + 1,
      color: C.textMuted,
      textAlign: 'center',
      marginTop: SPACING.xs,
      marginBottom: SPACING.xl,
    },
    onboardingCard: {
      backgroundColor: C.surface,
      borderRadius: RADIUS.surface,
      paddingHorizontal: SPACING.md,
      ...surfaceShadow(C),
    },
    onboardingStep: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: SPACING.md,
      gap: SPACING.sm,
    },
    onboardingStepBorder: {
      borderBottomWidth: 1,
      borderBottomColor: C.divider,
    },
    onboardingBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: C.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    onboardingBadgeText: {
      fontSize: TYPE_SIZE.label + 1,
      fontFamily: 'Inter_700Bold',
      color: C.primaryDeep,
    },
    onboardingStepText: {
      flex: 1,
      fontSize: TYPE_SIZE.body,
      color: C.textBody,
      lineHeight: 22,
    },

    // 画面共通ヘッダー
    screenHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: SPACING.sm,
      minHeight: 44,
    },
    headerSide: {
      width: 72,
      minHeight: 44,
      justifyContent: 'center',
    },
    headerSideRight: {
      alignItems: 'flex-end',
    },
    headerAction: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: SPACING.xxs,
    },
    headerActionText: {
      fontSize: TYPE_SIZE.body,
      fontWeight: '600',
      color: C.primary,
    },
    headerActionTextMuted: {
      color: C.textMuted,
    },
    headerPill: {
      height: 36,
      paddingHorizontal: SPACING.md,
      borderRadius: 18,
      backgroundColor: C.primaryButton,
      alignItems: 'center',
      justifyContent: 'center',
      ...primaryShadow(C),
    },
    headerPillText: {
      fontSize: TYPE_SIZE.label + 1,
      fontWeight: '600',
      color: C.onPrimary,
    },
    headerTitle: {
      flex: 1,
      fontSize: TYPE_SIZE.title,
      fontWeight: '700',
      textAlign: 'center',
      color: C.textDark,
      letterSpacing: -0.3,
    },

    // 設定画面
    settingsRow: {
      flexDirection: 'row',
      gap: SPACING.sm,
      marginTop: SPACING.xxs,
    },
    settingsInput: {
      ...inputBase,
      ...numberInput,
      flex: 1,
      minWidth: 0,
      padding: SPACING.md,
      fontSize: TYPE_SIZE.metric,
    },
    // 表示モードの3択
    segmentRow: {
      flexDirection: 'row',
      backgroundColor: C.surface,
      borderRadius: RADIUS.control,
      padding: 4,
      gap: 4,
      ...surfaceShadow(C),
    },
    segment: {
      flex: 1,
      height: 40,
      borderRadius: RADIUS.control - 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentActive: {
      backgroundColor: C.primaryTint,
    },
    segmentText: {
      fontSize: TYPE_SIZE.label + 1,
      fontWeight: '600',
      color: C.textGray,
    },
    segmentTextActive: {
      color: C.primaryDeep,
    },

    // 詳細画面
    detailDateBlock: {
      alignItems: 'center',
      marginBottom: SPACING.md,
    },
    detailDateText: {
      fontSize: TYPE_SIZE.body,
      fontFamily: 'Inter_700Bold',
      fontVariant: ['tabular-nums'],
      color: C.textDark,
      marginBottom: SPACING.xxs,
      letterSpacing: -0.2,
    },
    detailTimeText: {
      fontSize: TYPE_SIZE.label,
      fontFamily: 'Inter_600SemiBold',
      fontVariant: ['tabular-nums'],
      color: C.textGray,
    },
    detailSectionLabel: {
      fontSize: TYPE_SIZE.label,
      color: C.textMuted,
      fontWeight: '600',
      marginBottom: SPACING.xs,
      marginLeft: SPACING.xxs,
      letterSpacing: 0.3,
    },
    detailSection: {
      backgroundColor: C.surface,
      borderRadius: RADIUS.surface,
      paddingVertical: SPACING.xxs,
      paddingHorizontal: SPACING.md,
      marginBottom: SPACING.lg,
      ...surfaceShadow(C),
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: SPACING.sm,
    },
    detailLabel: {
      fontSize: TYPE_SIZE.label + 1,
      color: C.textGray,
    },
    detailValue: {
      fontSize: TYPE_SIZE.body,
      fontWeight: '600',
      color: C.textDark,
    },
    detailRateValue: {
      fontSize: TYPE_SIZE.emphasis,
      fontFamily: 'Inter_700Bold',
      fontVariant: ['tabular-nums'],
      color: C.primary,
      letterSpacing: -0.5,
    },
    detailDivider: {
      height: 1,
      backgroundColor: C.divider,
      marginVertical: 0,
    },
    shareButton: {
      height: 50,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: SPACING.xs,
      backgroundColor: C.surface,
      ...surfaceShadow(C),
    },
    shareButtonText: {
      fontSize: TYPE_SIZE.body,
      fontWeight: '600',
      color: C.primary,
    },
    deleteButton: {
      height: 50,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: SPACING.xs,
      marginBottom: SPACING.xl,
      backgroundColor: C.dangerTint,
    },
    deleteButtonText: {
      fontSize: TYPE_SIZE.body,
      fontWeight: '600',
      color: C.danger,
    },
    // メモ表示（詳細画面）
    detailMemoText: {
      fontSize: TYPE_SIZE.label + 1,
      color: C.textBody,
      paddingVertical: SPACING.sm,
      lineHeight: 22,
    },
    // 開始時の回転数（setup画面最上部の強調ブロック）
    startRotationBlock: {
      backgroundColor: C.surface,
      borderRadius: RADIUS.surface,
      padding: SPACING.md,
      marginTop: SPACING.xs,
      marginBottom: SPACING.sm,
      ...surfaceShadow(C),
    },
    startRotationLabel: {
      fontSize: TYPE_SIZE.label,
      color: C.textGray,
      fontWeight: '600',
      marginBottom: SPACING.xs,
      letterSpacing: 0.2,
    },

    // メモ入力欄（setup・編集画面）
    memoInput: {
      ...inputBase,
      padding: SPACING.md,
      fontSize: TYPE_SIZE.label + 1,
      minHeight: 90,
      maxHeight: 140,
      lineHeight: 20,
    },
    memoCounter: {
      fontSize: TYPE_SIZE.caption,
      color: C.textMuted,
      textAlign: 'right',
      marginTop: SPACING.xxs,
    },

    // 編集画面の時刻・回転数の横並び
    editTimeRow: {
      flexDirection: 'row',
      gap: SPACING.sm,
    },
    editTimeItem: {
      flex: 1,
    },
    // 日付入力（年/月/日）
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs,
    },
    dateInput: {
      ...inputBase,
      ...numberInput,
      flex: 1,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.xs,
      fontSize: TYPE_SIZE.metric,
    },
    dateInputYear: {
      flex: 1.5,
    },
    dateSeparator: {
      fontSize: TYPE_SIZE.metric,
      color: C.textMuted,
    },
    // 時刻入力（時:分）
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xxs,
    },
    timeInput: {
      ...inputBase,
      ...numberInput,
      flex: 1,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.xxs,
      fontSize: TYPE_SIZE.metric,
    },
    timeSeparator: {
      fontSize: TYPE_SIZE.metric,
      color: C.textMuted,
    },

    // 入力候補リスト
    suggestionsContainer: {
      backgroundColor: C.surface,
      borderRadius: RADIUS.control,
      marginTop: SPACING.xxs,
      marginBottom: SPACING.xxs,
      overflow: 'hidden',
      ...surfaceShadow(C),
    },
    suggestionItem: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: C.divider,
    },
    suggestionText: {
      fontSize: TYPE_SIZE.label + 1,
      color: C.textBody,
    },

    resetDefaultButton: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: SPACING.xs,
    },
    resetDefaultButtonText: {
      fontSize: TYPE_SIZE.label + 1,
      color: C.textMuted,
      fontWeight: '600',
    },

    // データ管理セクション（設定画面）
    dataSection: {
      marginTop: SPACING.xl,
      paddingTop: SPACING.lg,
      borderTopWidth: 1,
      borderTopColor: C.divider,
      marginBottom: SPACING.xl,
    },
    dataSectionLabel: {
      fontSize: TYPE_SIZE.label,
      color: C.textMuted,
      fontWeight: '600',
      marginBottom: SPACING.sm,
      letterSpacing: 0.3,
    },
    clearDataButton: {
      height: 48,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.dangerTint,
    },
    clearDataButtonText: {
      fontSize: TYPE_SIZE.label + 1,
      fontWeight: '600',
      color: C.danger,
    },

    // セッションカード
    listContent: {
      paddingTop: SPACING.xxs,
      paddingBottom: SPACING.md,
    },
    sessionCard: {
      backgroundColor: C.surface,
      borderRadius: RADIUS.surface,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
      ...surfaceShadow(C),
    },
    // カードヒーロー（回転率主役）
    cardHero: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    cardHeroLeft: {
      flex: 1,
    },
    cardHeroRight: {
      alignItems: 'flex-end',
      paddingTop: 2,
    },
    cardRateValue: {
      fontSize: TYPE_SIZE.cardRate,
      fontFamily: 'Inter_700Bold',
      fontVariant: ['tabular-nums'],
      color: C.primary,
      lineHeight: 44,
      letterSpacing: -1,
    },
    cardRateLabel: {
      fontSize: TYPE_SIZE.caption,
      color: C.textMuted,
      marginTop: 2,
      letterSpacing: 0.3,
    },
    cardDate: {
      fontSize: TYPE_SIZE.caption,
      fontFamily: 'Inter_600SemiBold',
      fontVariant: ['tabular-nums'],
      color: C.textGray,
    },
    cardTime: {
      fontSize: TYPE_SIZE.caption,
      fontFamily: 'Inter_600SemiBold',
      fontVariant: ['tabular-nums'],
      color: C.textMuted,
      marginTop: 2,
    },
    cardDivider: {
      height: 1,
      backgroundColor: C.divider,
      marginVertical: SPACING.sm,
    },
    cardStore: {
      fontSize: TYPE_SIZE.caption,
      color: C.textMuted,
      marginBottom: 2,
    },
    cardMachine: {
      fontSize: TYPE_SIZE.body,
      fontWeight: '600',
      color: C.textDark,
      marginBottom: SPACING.xs,
    },
    cardCountsRow: {
      flexDirection: 'row',
      gap: SPACING.lg,
    },
    cardCount: {
      fontSize: TYPE_SIZE.label + 1,
      color: C.textGray,
    },

    // フォーム共通
    label: {
      fontSize: TYPE_SIZE.label,
      color: C.textGray,
      fontWeight: '600',
      marginTop: SPACING.md,
      marginBottom: SPACING.xs,
      marginLeft: 2,
      letterSpacing: 0.2,
    },
    required: {
      color: C.danger,
      fontSize: TYPE_SIZE.caption,
      fontWeight: '600',
    },
    hint: {
      fontSize: TYPE_SIZE.caption,
      color: C.textMuted,
      marginBottom: SPACING.xs,
      marginTop: -2,
    },
    input: {
      ...inputBase,
      padding: SPACING.md,
      fontSize: TYPE_SIZE.body,
    },
    // 大きい数字の入力欄（setup の開始回転数・リセット画面）
    inputLarge: {
      ...numberInput,
      backgroundColor: C.surfaceSunken,
      borderRadius: RADIUS.control,
      height: 56,
      fontSize: TYPE_SIZE.input,
      color: C.textDark,
      letterSpacing: -0.5,
    },

    // 遊技中画面
    playingScroll: {
      flex: 1,
      marginHorizontal: -SPACING.md,
    },
    playingScrollContent: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.xl,
      gap: SPACING.sm,
    },
    // 回転数・使用玉数のカード（入力欄＋ボタン6個で1枚）
    playingCard: {
      backgroundColor: C.surface,
      borderRadius: RADIUS.surface,
      padding: SPACING.sm,
      ...surfaceShadow(C),
    },
    playingStoreName: {
      fontSize: TYPE_SIZE.caption,
      color: C.textMuted,
      letterSpacing: 0.3,
    },
    playingMachineName: {
      fontSize: TYPE_SIZE.label + 1,
      fontWeight: '600',
      color: C.textBody,
      marginTop: 1,
    },
    playingLabel: {
      fontSize: TYPE_SIZE.label,
      color: C.textGray,
      fontWeight: '600',
      letterSpacing: 0.2,
      marginLeft: 2,
      marginBottom: SPACING.xs,
    },
    // 遊技中の入力欄（カードの中なので一段沈んだ色）
    playingInput: {
      ...numberInput,
      backgroundColor: C.surfaceSunken,
      borderRadius: RADIUS.control,
      height: 52,
      fontSize: TYPE_SIZE.input,
      color: C.textDark,
      letterSpacing: -0.5,
    },

    // ボタン行（+/- 共通の横並び）
    btnRow: {
      flexDirection: 'row',
      gap: SPACING.xs,
      marginTop: SPACING.xs,
    },
    // 加算ボタン（薄い青地・大きめ）
    btnIncrement: {
      flex: 1,
      height: 50,
      backgroundColor: C.primaryTint,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnIncrementText: {
      fontSize: TYPE_SIZE.body,
      fontFamily: 'Inter_600SemiBold',
      fontVariant: ['tabular-nums'],
      color: C.primaryDeep,
    },
    // 減算ボタン（沈んだ地・小さめ）
    btnDecrement: {
      flex: 1,
      height: 42,
      backgroundColor: C.surfaceSunken,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnDecrementText: {
      fontSize: TYPE_SIZE.label + 1,
      fontFamily: 'Inter_600SemiBold',
      fontVariant: ['tabular-nums'],
      color: C.textGray,
    },

    // リセットして続けるボタン
    resetButton: {
      height: 46,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.surface,
      ...surfaceShadow(C),
    },
    resetButtonText: {
      fontSize: TYPE_SIZE.label + 1,
      fontWeight: '600',
      color: C.primary,
    },

    // 遊技中画面の上部エリア（回転率のカード）
    rateDisplay: {
      backgroundColor: C.surface,
      borderRadius: RADIUS.surface,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.lg,
      alignItems: 'center',
      ...surfaceShadow(C),
    },
    rateDisplayValue: {
      fontSize: TYPE_SIZE.liveRate,
      fontFamily: 'Inter_700Bold',
      fontVariant: ['tabular-nums'],
      color: C.primary,
      lineHeight: 58,
      letterSpacing: -1.5,
      marginTop: SPACING.xxs,
    },
    rateUnit: {
      fontSize: TYPE_SIZE.caption,
      color: C.textMuted,
      marginTop: 2,
      letterSpacing: 0.3,
    },

    // 総回転数・総使用玉数の横並び表示
    totalRow: {
      flexDirection: 'row',
      marginTop: SPACING.sm,
      paddingTop: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: C.divider,
      width: '100%',
    },
    totalItem: {
      flex: 1,
      alignItems: 'center',
    },
    totalDivider: {
      width: 1,
      backgroundColor: C.divider,
    },
    totalLabel: {
      fontSize: TYPE_SIZE.caption,
      color: C.textMuted,
      marginBottom: 2,
      letterSpacing: 0.3,
    },
    totalValue: {
      fontSize: TYPE_SIZE.metric,
      fontFamily: 'Inter_700Bold',
      fontVariant: ['tabular-nums'],
      color: C.textDark,
    },

    // ボタン（ホーム・setup 画面共通）
    primaryButton: {
      backgroundColor: C.primaryButton,
      height: 52,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: SPACING.sm,
      ...primaryShadow(C),
    },
    primaryButtonText: {
      color: C.onPrimary,
      fontSize: TYPE_SIZE.body,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    outlineButton: {
      height: 50,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: SPACING.xs,
      backgroundColor: C.surface,
      ...surfaceShadow(C),
    },
    outlineButtonText: {
      color: C.primary,
      fontSize: TYPE_SIZE.body,
      fontWeight: '600',
    },
    secondaryButton: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: SPACING.xs,
    },
    secondaryButtonText: {
      color: C.textMuted,
      fontSize: TYPE_SIZE.label + 1,
      fontWeight: '600',
    },
  });
}
