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
} from 'react-native';
import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// 設定のデフォルト値
const DEFAULT_SETTINGS = {
  rateBalls: 250,
  ballButtons: [125, 250, 1000],
  rotationButtons: [1, 10, 100],
};

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
const COLORS = {
  primary: '#0066FF',        // メインの青（ボタン・強調値）
  primaryLight: '#EFF6FF',   // 青の薄い背景
  primaryBorder: '#DBEAFE',  // 青の薄い枠線
  white: '#FFFFFF',          // カード・入力欄の背景
  background: '#F8F9FC',     // 画面全体の背景
  border: '#E5E7EB',         // 標準の境界線
  borderLight: '#F3F4F6',    // 薄い境界線・区切り線
  textDark: '#111827',       // 見出し・数値の強調
  textBody: '#374151',       // 本文テキスト
  textGray: '#6B7280',       // ラベル
  textMuted: '#9CA3AF',      // 補助テキスト・プレースホルダー
  danger: '#FF3B30',         // 削除など危険な操作の赤
  dangerBorder: '#FECACA',   // 赤系の枠線
};

export default function App() {
  // 現在の画面（値は SCREEN 定数を参照）
  const [screen, setScreen] = useState(SCREEN.HOME);
  // 保存済みセッション一覧
  const [sessions, setSessions] = useState([]);

  // グローバル設定
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // 設定画面の編集中ドラフト
  const [draftRateBalls, setDraftRateBalls] = useState('250');
  const [draftBallButtons, setDraftBallButtons] = useState(['125', '250', '1000']);
  const [draftRotationButtons, setDraftRotationButtons] = useState(['1', '10', '100']);

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

  // アプリ起動時にデータ・設定・履歴を読み込む
  useEffect(() => {
    loadSessions();
    loadSettings();
    loadNames();
  }, []);

  // AsyncStorageから設定を読み込む
  const loadSettings = async () => {
    try {
      const data = await AsyncStorage.getItem(SETTINGS_KEY);
      if (data !== null) {
        setSettings(JSON.parse(data));
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
  const loadSessions = async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data !== null) {
        setSessions(JSON.parse(data));
      }
    } catch (error) {
      Alert.alert('エラー', 'データの読み込みに失敗しました');
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

    const now = new Date();
    const newSession = {
      id: Date.now().toString(),
      date: now.toLocaleDateString('ja-JP'),
      startTime: startTime
        ? startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
        : '--',
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
      const updatedSessions = [newSession, ...sessions];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
      setSessions(updatedSessions);
      await saveNameHistory(machineName.trim(), storeName.trim());
      resetForm();
      setScreen(SCREEN.HOME);
    } catch (error) {
      Alert.alert('エラー', 'データの保存に失敗しました');
    }
  };

  // 設定画面を開く（現在の設定値をドラフトにコピー）
  const handleOpenSettings = () => {
    setDraftRateBalls(String(settings.rateBalls));
    setDraftBallButtons(settings.ballButtons.map(String));
    setDraftRotationButtons(settings.rotationButtons.map(String));
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

    const newSettings = { rateBalls, ballButtons, rotationButtons };
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
    // 終了時刻が開始時刻より前ではないかチェック
    if (eh * 60 + em < sh * 60 + sm) {
      Alert.alert('入力エラー', '終了時刻は開始時刻以降にしてください');
      return;
    }

    const pad = (s) => String(s || '').padStart(2, '0');
    const date = `${year}/${month}/${day}`;
    const startTime = `${pad(sh)}:${pad(sm)}`;
    const endTime = `${pad(eh)}:${pad(em)}`;

    const updated = sessions.map((s) =>
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
    setStartRotation(rotation);
    setEndRotation(''); // 空欄スタート（プレースホルダーに引き継ぎ回転数を表示）
    setStartTime(new Date());
    setAccumulatedRotations(item.rotations);
    setAccumulatedBalls(item.ballsUsed);
    setScreen(SCREEN.PLAYING);
  };

  // 共有テキストを組み立てる（メモは含めない）
  const buildShareText = (item) => {
    const lines = ['【遊技記録】'];
    if (item.date) lines.push(`📅 ${item.date}`);
    if (item.storeName) lines.push(`🏪 ${item.storeName}`);
    const machine = `${item.machineName || ''}${item.machineNumber ? `（${item.machineNumber}番台）` : ''}`;
    if (machine) lines.push(`🎰 ${machine}`);
    if (item.startTime && item.endTime && item.startTime !== '--') {
      const dur = calcDuration(item.startTime, item.endTime);
      lines.push(`⏱ ${item.startTime} - ${item.endTime}${dur ? `（${dur}）` : ''}`);
    }
    lines.push('');
    lines.push(`🔄 総回転数: ${item.rotations.toLocaleString()}`);
    lines.push(`⚪ 総使用玉数: ${item.ballsUsed.toLocaleString()}`);
    const rate = item.ballsUsed > 0
      ? ((item.rotations / item.ballsUsed) * settings.rateBalls).toFixed(1)
      : '--';
    lines.push(`✨ ${settings.rateBalls}玉あたり回転数: ${rate}`);
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
            const updated = sessions.filter((s) => s.id !== id);
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
    if (mins < 0) return '';
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
  if (screen === SCREEN.HOME) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.homeHeader}>
          <Text style={styles.title}>パチカウント</Text>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={handleOpenSettings}
            activeOpacity={0.7}
          >
            <Text style={styles.settingsButtonText}>⚙</Text>
          </TouchableOpacity>
        </View>

        {sessions.length === 0 ? (
          // 記録がない場合
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>記録がありません</Text>
            <Text style={styles.emptySubText}>「遊技開始」から記録を始めてください</Text>
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
                activeOpacity={0.7}
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
                    <Text style={styles.cardDate}>
                      {item.date}{item.memo ? '  📝' : ''}
                    </Text>
                    <Text style={styles.cardTime}>{item.startTime} – {item.endTime}</Text>
                  </View>
                </View>

                {/* 区切り線 */}
                <View style={styles.cardDivider} />

                {/* 台情報 */}
                {item.storeName ? (
                  <Text style={styles.cardStore}>🏪  {item.storeName}</Text>
                ) : null}
                <Text style={styles.cardMachine}>
                  🎰  {item.machineName || '機種未入力'}
                  {item.machineNumber ? `（${item.machineNumber}番台）` : ''}
                </Text>

                {/* 集計値 */}
                <View style={styles.cardCountsRow}>
                  <Text style={styles.cardCount}>
                    🔄  {item.rotations.toLocaleString()} 回転
                  </Text>
                  <Text style={styles.cardCount}>
                    ⚪  {item.ballsUsed.toLocaleString()} 玉
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}

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
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>台情報を入力</Text>
          <Text style={styles.subtitle}>現在の台の情報を入力してください</Text>

          {/* 開始時の回転数（必須・最上部で目立たせる） */}
          <View style={styles.startRotationBlock}>
            <Text style={styles.startRotationLabel}>
              開始時の回転数 <Text style={styles.required}>必須</Text>
            </Text>
            <Text style={styles.hint}>
              現在の回転数表示をそのまま入力してください
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
          <Text style={styles.label}>
            機種名 <Text style={styles.optional}>任意</Text>
          </Text>
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
          <Text style={styles.label}>
            店舗名 <Text style={styles.optional}>任意</Text>
          </Text>
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
          <Text style={styles.label}>
            台番号 <Text style={styles.optional}>任意</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={machineNumber}
            onChangeText={setMachineNumber}
            keyboardType="numeric"
            maxLength={5}
            returnKeyType="next"
          />

          {/* メモ（任意・200文字以内） */}
          <Text style={styles.label}>
            メモ <Text style={styles.optional}>任意・200文字以内</Text>
          </Text>
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

          {/* 戻るボタン */}
          <AppButton
            label="戻る"
            variant="secondary"
            onPress={() => { resetForm(); setScreen(SCREEN.HOME); }}
          />
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

    return (
      <View style={styles.container}>
        <StatusBar style="dark" />

        {/* ヘッダー */}
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setScreen(SCREEN.HOME)} style={styles.detailBackButton}>
            <Text style={styles.detailBackText}>← 戻る</Text>
          </TouchableOpacity>
          <Text style={styles.detailTitle}>記録の詳細</Text>
          <View style={styles.detailHeaderSpacer} />
        </View>

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
            <DetailRow label="台番号" value={item.machineNumber || '-'} />
          </View>

          {/* 遊技データ */}
          <Text style={styles.detailSectionLabel}>遊技データ</Text>
          <View style={styles.detailSection}>
            <DetailRow label="総回転数" value={item.rotations.toLocaleString()} />
            <DetailRow label="総使用玉数" value={item.ballsUsed.toLocaleString()} />
            <View style={styles.detailDivider} />
            <DetailRow label={`${settings.rateBalls}玉あたり回転数`} value={rate} highlight />
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
          <AppButton label="編集する" onPress={() => handleOpenEdit(item)} />
          <AppButton label="続きから遊技" onPress={() => handleContinueSession(item)} />
          <TouchableOpacity style={styles.shareButton} onPress={() => handleShareSession(item)}>
            <Text style={styles.shareButtonText}>共有する</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteSession(item.id)}>
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
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>記録を編集</Text>

          <Text style={styles.label}>機種名</Text>
          <TextInput style={styles.input} value={editDraft.machineName}
            onChangeText={(v) => updateEditDraft('machineName', v)}
            maxLength={50} />

          <Text style={styles.label}>店舗名</Text>
          <TextInput style={styles.input} value={editDraft.storeName}
            onChangeText={(v) => updateEditDraft('storeName', v)}
            maxLength={50} />

          <Text style={styles.label}>台番号</Text>
          <TextInput style={styles.input} value={editDraft.machineNumber}
            onChangeText={(v) => updateEditDraft('machineNumber', v)}
            keyboardType="numeric"
            maxLength={5} />

          <Text style={styles.label}>
            メモ <Text style={styles.optional}>200文字以内</Text>
          </Text>
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
            />
            <Text style={styles.dateSeparator}>/</Text>
            <TextInput
              style={styles.dateInput}
              value={editDraft.dateMonth}
              onChangeText={(v) => updateEditDraft('dateMonth', v)}
              keyboardType="numeric"
              maxLength={2}
              placeholder="月"
            />
            <Text style={styles.dateSeparator}>/</Text>
            <TextInput
              style={styles.dateInput}
              value={editDraft.dateDay}
              onChangeText={(v) => updateEditDraft('dateDay', v)}
              keyboardType="numeric"
              maxLength={2}
              placeholder="日"
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
                />
                <Text style={styles.timeSeparator}>:</Text>
                <TextInput
                  style={styles.timeInput}
                  value={editDraft.startMinute}
                  onChangeText={(v) => updateEditDraft('startMinute', v)}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="分"
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
                />
                <Text style={styles.timeSeparator}>:</Text>
                <TextInput
                  style={styles.timeInput}
                  value={editDraft.endMinute}
                  onChangeText={(v) => updateEditDraft('endMinute', v)}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="分"
                />
              </View>
            </View>
          </View>

          <AppButton label="保存する" onPress={handleSaveEdit} />
          <AppButton label="キャンセル" variant="secondary" onPress={() => setScreen(SCREEN.HOME)} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // 設定画面（settings）
  // ========================================
  if (screen === SCREEN.SETTINGS) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>設定</Text>

          {/* 基準玉数 */}
          <Text style={styles.label}>回転率の基準玉数</Text>
          <Text style={styles.hint}>例: 250（指定した玉数あたりの回転数で計算）</Text>
          <TextInput
            style={styles.input}
            value={draftRateBalls}
            onChangeText={setDraftRateBalls}
            keyboardType="numeric"
            returnKeyType="done"
          />

          {/* 使用玉数ボタンの値 */}
          <Text style={styles.label}>使用玉数ボタンの値（3つ）</Text>
          <Text style={styles.hint}>遊技中に表示される±ボタンの増減量</Text>
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
          <Text style={styles.label}>回転数ボタンの値（3つ）</Text>
          <Text style={styles.hint}>遊技中に表示される±ボタンの増減量</Text>
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

          <AppButton label="保存する" onPress={handleSaveSettings} />
          <TouchableOpacity
            style={styles.resetDefaultButton}
            onPress={() => {
              Alert.alert(
                'デフォルトに戻しますか？',
                '設定がすべて初期値にリセットされます',
                [
                  { text: 'キャンセル', style: 'cancel' },
                  {
                    text: 'リセット',
                    style: 'destructive',
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
            <TouchableOpacity style={styles.clearDataButton} onPress={handleClearSessions}>
              <Text style={styles.clearDataButtonText}>すべての記録を削除</Text>
            </TouchableOpacity>
          </View>

          <AppButton label="キャンセル" variant="secondary" onPress={() => setScreen(SCREEN.HOME)} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // リセット入力画面（reset）
  // ========================================
  if (screen === SCREEN.RESET) {
    const currentTotal = calcTotalRotations();
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style="dark" />
        <Text style={styles.title}>回転数リセット</Text>
        <Text style={styles.subtitle}>
          ここまでの遊技回転数: {currentTotal.toLocaleString()} 回転
        </Text>

        <Text style={styles.label}>リセット後の回転数（台の表示）</Text>
        <Text style={styles.hint}>大当たり後などに台に表示されている回転数を入力してください</Text>
        <TextInput
          style={[styles.input, { fontSize: 22, textAlign: 'center', height: 56 }]}
          value={newResetRotation}
          onChangeText={setNewResetRotation}
          keyboardType="numeric"
          maxLength={7}
          autoFocus
        />

        <AppButton label="継続する" onPress={handleConfirmReset} />
        <AppButton label="キャンセル（遊技中に戻る）" variant="secondary" onPress={() => setScreen(SCREEN.PLAYING)} />
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // 遊技中画面（playing）- スクロールなしの1画面レイアウト
  // ========================================
  return (
    <KeyboardAvoidingView
      style={styles.playingContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

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

      {/* ===== 入力エリア（回転数 + 使用玉数） ===== */}
      <View style={styles.playingContent}>

        {/* 回転数セクション */}
        <View>
          <Text style={styles.playingLabel}>現在の回転数</Text>
          <TextInput
            style={styles.playingInput}
            placeholder={startRotation || '0'}
            value={endRotation}
            onChangeText={setEndRotation}
            keyboardType="numeric"
            maxLength={7}
            selectTextOnFocus={true}
          />
          <View style={styles.btnRow}>
            {settings.rotationButtons.map((n) => (
              <TouchableOpacity
                key={`r+${n}`}
                style={styles.btnIncrement}
                onPress={() => addToEndRotation(n)}
              >
                <Text style={styles.btnIncrementText}>+{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.btnRow}>
            {settings.rotationButtons.map((n) => (
              <TouchableOpacity
                key={`r-${n}`}
                style={styles.btnDecrement}
                onPress={() => addToEndRotation(-n)}
              >
                <Text style={styles.btnDecrementText}>-{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 区切り線 */}
        <View style={styles.divider} />

        {/* 使用玉数セクション */}
        <View>
          <Text style={styles.playingLabel}>使用玉数</Text>
          <TextInput
            style={styles.playingInput}
            placeholder="0"
            value={ballsUsed}
            onChangeText={setBallsUsed}
            keyboardType="numeric"
            maxLength={7}
          />
          <View style={styles.btnRow}>
            {settings.ballButtons.map((n) => (
              <TouchableOpacity
                key={`b+${n}`}
                style={styles.btnIncrement}
                onPress={() => addToBallsUsed(n)}
              >
                <Text style={styles.btnIncrementText}>+{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.btnRow}>
            {settings.ballButtons.map((n) => (
              <TouchableOpacity
                key={`b-${n}`}
                style={styles.btnDecrement}
                onPress={() => addToBallsUsed(-n)}
              >
                <Text style={styles.btnDecrementText}>-{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* ===== リセットして続けるボタン（独立配置・常時表示） ===== */}
      <View style={styles.resetButtonRow}>
        <TouchableOpacity style={styles.resetButton} onPress={handleOpenReset}>
          <Text style={styles.resetButtonText}>リセットして続ける</Text>
        </TouchableOpacity>
      </View>

      {/* ===== 下部固定: 終了・中断ボタン ===== */}
      <View style={styles.playingFooter}>
        <AppButton label="遊技終了・保存" onPress={handleEndSession} />
        <AppButton label="中断する（保存しない）" variant="secondary" onPress={handleAbort} />
      </View>

    </KeyboardAvoidingView>
  );
}

// ========================================
// 再利用コンポーネント
// ========================================

// 共通ボタン（variant で primary / secondary を切り替え）
function AppButton({ label, onPress, variant = 'primary' }) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      style={isPrimary ? styles.primaryButton : styles.secondaryButton}
      onPress={onPress}
    >
      <Text style={isPrimary ? styles.primaryButtonText : styles.secondaryButtonText}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// 詳細画面の1行（label と value の横並び。highlight=true で回転率を強調表示）
function DetailRow({ label, value, highlight }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && styles.detailRateValue]}>
        {value}
      </Text>
    </View>
  );
}

// ========================================
// スタイル定義
// ========================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: COLORS.textDark,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    color: COLORS.textMuted,
    marginBottom: 24,
  },

  // ホーム: 記録なしの表示
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginBottom: 8,
  },
  emptySubText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },

  // ホーム: 遊技開始ボタンの下部余白（ジェスチャーバー/ホームインジケーター回避）
  homeFooter: {
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },

  // ホームヘッダー（タイトル + 設定ボタン）
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 44,
    position: 'relative',
  },
  settingsButton: {
    position: 'absolute',
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingsButtonText: {
    fontSize: 20,
    color: COLORS.textGray,
    lineHeight: 24,
  },

  // 設定画面
  settingsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  settingsInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlign: 'center',
    color: COLORS.textDark,
  },

  // 詳細画面
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  detailBackButton: {
    paddingVertical: 4,
    width: 70,
  },
  detailBackText: {
    fontSize: 15,
    color: COLORS.primary,
    fontWeight: '500',
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textDark,
    letterSpacing: -0.2,
  },
  detailHeaderSpacer: {
    width: 70,
  },
  detailDateBlock: {
    alignItems: 'center',
    marginBottom: 18,
  },
  detailDateText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  detailTimeText: {
    fontSize: 13,
    color: COLORS.textGray,
  },
  detailSectionLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detailSection: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: COLORS.textGray,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  detailRateValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  detailDivider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginVertical: 0,
  },
  shareButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  deleteButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.white,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.danger,
  },
  // メモ表示（詳細画面）
  detailMemoText: {
    fontSize: 14,
    color: COLORS.textBody,
    paddingVertical: 12,
    lineHeight: 22,
  },
  // 開始時の回転数（setup画面最上部の強調ブロック）
  startRotationBlock: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 18,
    marginTop: 8,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  startRotationLabel: {
    fontSize: 14,
    color: COLORS.textDark,
    fontWeight: '600',
    marginBottom: 6,
    letterSpacing: 0.2,
  },

  // メモ入力欄（setup・編集画面）
  memoInput: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 90,
    maxHeight: 140,
    lineHeight: 20,
    color: COLORS.textDark,
  },
  memoCounter: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },

  // 編集画面の時刻・回転数の横並び
  editTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  editTimeItem: {
    flex: 1,
  },
  // 日付入力（年/月/日）
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 18,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlign: 'center',
    color: COLORS.textDark,
  },
  dateInputYear: {
    flex: 1.5,
  },
  dateSeparator: {
    fontSize: 18,
    color: COLORS.textMuted,
  },
  // 時刻入力（時:分）
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    fontSize: 18,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlign: 'center',
    color: COLORS.textDark,
  },
  timeSeparator: {
    fontSize: 18,
    color: COLORS.textMuted,
  },

  // 入力候補リスト
  suggestionsContainer: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 4,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  suggestionText: {
    fontSize: 14,
    color: COLORS.textBody,
  },

  resetDefaultButton: {
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.white,
  },
  resetDefaultButtonText: {
    fontSize: 14,
    color: COLORS.danger,
    fontWeight: '500',
  },

  // データ管理セクション（設定画面）
  dataSection: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  dataSectionLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  clearDataButton: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.white,
  },
  clearDataButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.danger,
  },

  // セッションカード
  listContent: {
    paddingBottom: 16,
  },
  sessionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  // カードヒーロー（回転率主役）
  cardHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardHeroLeft: {
    flex: 1,
  },
  cardHeroRight: {
    alignItems: 'flex-end',
  },
  cardRateValue: {
    fontSize: 34,
    fontWeight: '700',
    color: COLORS.primary,
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  cardRateLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  cardDate: {
    fontSize: 12,
    color: COLORS.textGray,
    fontWeight: '500',
  },
  cardTime: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginVertical: 4,
    marginBottom: 12,
  },
  cardStore: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 4,
  },
  cardMachine: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 10,
  },
  cardCountsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardCount: {
    fontSize: 13,
    color: COLORS.textBody,
    fontWeight: '500',
  },

  // フォーム共通
  label: {
    fontSize: 13,
    color: COLORS.textBody,
    fontWeight: '600',
    marginTop: 18,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  required: {
    color: COLORS.danger,
    fontSize: 11,
    fontWeight: '500',
  },
  optional: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '400',
  },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
    marginTop: -2,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textDark,
  },
  // 遊技中画面用の大きい入力欄
  inputLarge: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 28,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlign: 'center',
    color: COLORS.textDark,
    letterSpacing: -0.5,
  },

  // 遊技中画面のルートコンテナ
  playingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 36,
  },

  // 遊技中画面の入力エリア全体
  playingContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 6,
    justifyContent: 'center',
  },
  // リセットして続けるボタンの独立配置行（入力エリアとフッターの間）
  resetButtonRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },

  // 遊技中画面の下部固定フッター
  playingFooter: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
  },

  playingStoreName: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginBottom: 1,
    letterSpacing: 0.3,
  },
  playingMachineName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textBody,
    marginBottom: 4,
  },
  playingLabel: {
    fontSize: 12,
    color: COLORS.textGray,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 4,
  },

  // 遊技中の入力欄
  playingInput: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    height: 54,
    fontSize: 26,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlign: 'center',
    color: COLORS.textDark,
    letterSpacing: -0.5,
  },

  // ボタン行（+/- 共通の横並び）
  btnRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 5,
  },
  // 加算ボタン（青・減算の2倍の高さ）
  btnIncrement: {
    flex: 1,
    height: 54,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnIncrementText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  // 減算ボタン（赤・加算の半分の高さ）
  btnDecrement: {
    flex: 1,
    height: 28,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnDecrementText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textGray,
  },

  // リセットして続けるボタン
  resetButton: {
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.primaryBorder,
    backgroundColor: COLORS.primaryLight,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },

  // 区切り線
  divider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginVertical: 8,
  },

  // 遊技中画面の上部エリア
  rateDisplay: {
    backgroundColor: COLORS.white,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rateDisplayValue: {
    fontSize: 40,
    fontWeight: '700',
    color: COLORS.primary,
    lineHeight: 46,
    letterSpacing: -1,
  },
  rateUnit: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
    letterSpacing: 0.3,
  },

  // 総回転数・総使用玉数の横並び表示
  totalRow: {
    flexDirection: 'row',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    width: '100%',
  },
  totalItem: {
    flex: 1,
    alignItems: 'center',
  },
  totalDivider: {
    width: 1,
    backgroundColor: COLORS.borderLight,
  },
  totalLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginBottom: 2,
    letterSpacing: 0.3,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textDark,
  },

  // ボタン（ホーム・setup 画面共通）
  primaryButton: {
    backgroundColor: COLORS.primary,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  secondaryButtonText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
});
