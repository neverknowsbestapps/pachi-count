import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

export default function App() {
  // 現在の画面: 'home' | 'setup' | 'playing' | 'reset' | 'settings'
  const [screen, setScreen] = useState('home');
  // 保存済みセッション一覧
  const [sessions, setSessions] = useState([]);

  // グローバル設定
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // 設定画面の編集中ドラフト
  const [draftRateBalls, setDraftRateBalls] = useState('250');
  const [draftBallButtons, setDraftBallButtons] = useState(['125', '250', '1000']);
  const [draftRotationButtons, setDraftRotationButtons] = useState(['1', '10', '100']);

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
    setEndRotation(startRotation);
    setScreen('playing');
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
      Alert.alert('入力エラー', '現在の回転数は開始時より大きい値を入力してください');
      return;
    }

    // 合計回転数・合計玉数（累積 + 現セグメント）
    const rotationsNum = accumulatedRotations + Math.max(0, endRotationNum - startRotationNum);
    const totalBallsNum = accumulatedBalls + ballsNum;

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
      // rotationRate は表示時に動的に計算するため保存しない
    };

    try {
      const updatedSessions = [newSession, ...sessions];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
      setSessions(updatedSessions);
      await saveNameHistory(machineName.trim(), storeName.trim());
      resetForm();
      setScreen('home');
    } catch (error) {
      Alert.alert('エラー', 'データの保存に失敗しました');
    }
  };

  // 設定画面を開く（現在の設定値をドラフトにコピー）
  const handleOpenSettings = () => {
    setDraftRateBalls(String(settings.rateBalls));
    setDraftBallButtons(settings.ballButtons.map(String));
    setDraftRotationButtons(settings.rotationButtons.map(String));
    setScreen('settings');
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
      setScreen('home');
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
      dateYear: year,
      dateMonth: month,
      dateDay: day,
      startHour: sh,
      startMinute: sm,
      endHour: eh,
      endMinute: em,
      id: item.id,
    });
    setScreen('edit');
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
            date,
            startTime,
            endTime,
          }
        : s
    );
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSessions(updated);
      setScreen('home');
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
    setEndRotation(rotation);
    setStartTime(new Date());
    setAccumulatedRotations(item.rotations);
    setAccumulatedBalls(item.ballsUsed);
    setScreen('playing');
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
            } catch (error) {
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
      'このセッションのデータは保存されません',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '中断する',
          style: 'destructive',
          onPress: () => {
            resetForm();
            setScreen('home');
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
    setScreen('reset');
  };

  // リセット確定：現セグメントの回転数を累積して新しい開始回転数をセット
  const handleConfirmReset = () => {
    if (!newResetRotation.trim() || isNaN(Number(newResetRotation))) {
      Alert.alert('入力エラー', 'リセット後の回転数を入力してください');
      return;
    }
    // ここまでのセグメントの回転数・玉数を累積に加算
    const segmentRotations = Math.max(
      0,
      parseInt(endRotation, 10) - parseInt(startRotation, 10)
    );
    const segmentBalls = Math.max(0, parseInt(ballsUsed, 10) || 0);
    setAccumulatedRotations((prev) => prev + segmentRotations);
    setAccumulatedBalls((prev) => prev + segmentBalls);

    // 新しい開始回転数で続行・使用玉数の表示は0にリセット
    setStartRotation(newResetRotation);
    setEndRotation(newResetRotation);
    setBallsUsed('0');
    setNewResetRotation('');
    setScreen('playing');
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

  // ========================================
  // ホーム画面
  // ========================================
  if (screen === 'home') {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.homeHeader}>
          <Text style={styles.title}>回転カウンター</Text>
          <TouchableOpacity style={styles.settingsButton} onPress={handleOpenSettings}>
            <Text style={styles.settingsButtonText}>設定</Text>
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
                activeOpacity={0.8}
                onPress={() => {
                  Alert.alert(
                    item.machineName || '機種未入力',
                    item.date,
                    [
                      { text: '編集する', onPress: () => handleOpenEdit(item) },
                      { text: '続きから遊技', onPress: () => handleContinueSession(item) },
                      { text: '削除', style: 'destructive', onPress: () => handleDeleteSession(item.id) },
                      { text: 'キャンセル', style: 'cancel' },
                    ]
                  );
                }}
              >
                {/* カードヘッダー：日付・時刻 */}
                <View style={styles.cardHeader}>
                  <Text style={styles.sessionDate}>{item.date}</Text>
                  <Text style={styles.sessionTime}>
                    {item.startTime} - {item.endTime}
                  </Text>
                </View>

                {/* 店舗名 */}
                {item.storeName ? (
                  <Text style={styles.sessionStore}>{item.storeName}</Text>
                ) : null}

                {/* 機種名・台番号 */}
                <Text style={styles.sessionMachine}>
                  {item.machineName || '機種未入力'}
                  {item.machineNumber ? `（${item.machineNumber}番台）` : ''}
                </Text>

                {/* 統計の横並び表示 */}
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>遊技回転</Text>
                    <Text style={styles.statValue}>
                      {item.rotations.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>使用玉</Text>
                    <Text style={styles.statValue}>
                      {item.ballsUsed.toLocaleString()}
                    </Text>
                  </View>
                  {/* 玉あたり回転は色付きで強調（現在の基準玉数で動的計算） */}
                  <View style={[styles.statItem, styles.rateItem]}>
                    <Text style={styles.statLabel}>{settings.rateBalls}玉回転</Text>
                    <Text style={[styles.statValue, styles.rateValue]}>
                      {item.ballsUsed > 0
                        ? ((item.rotations / item.ballsUsed) * settings.rateBalls).toFixed(1)
                        : '--'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* 遊技開始ボタン */}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => setScreen('setup')}
        >
          <Text style={styles.primaryButtonText}>遊技開始</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ========================================
  // 台情報入力画面（setup）
  // ========================================
  if (screen === 'setup') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>台情報を入力</Text>
          <Text style={styles.subtitle}>座った台の情報を入力してください</Text>

          {/* 機種名（任意）+ 履歴候補 */}
          <Text style={styles.label}>
            機種名 <Text style={styles.optional}>任意</Text>
          </Text>
          <TextInput
            style={styles.input}
            placeholder="例: 海物語、エヴァ15など"
            value={machineName}
            onChangeText={(text) => { setMachineName(text); setShowMachineSuggestions(true); }}
            onFocus={() => setShowMachineSuggestions(true)}
            onBlur={() => setTimeout(() => setShowMachineSuggestions(false), 200)}
            returnKeyType="next"
          />
          {showMachineSuggestions && machineNameHistory.filter((n) =>
            n.toLowerCase().includes(machineName.toLowerCase())
          ).length > 0 && (
            <View style={styles.suggestionsContainer}>
              {machineNameHistory
                .filter((n) => n.toLowerCase().includes(machineName.toLowerCase()))
                .map((name, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.suggestionItem}
                    onPress={() => { setMachineName(name); setShowMachineSuggestions(false); }}
                  >
                    <Text style={styles.suggestionText}>{name}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          )}

          {/* 店舗名（任意）+ 履歴候補 */}
          <Text style={styles.label}>
            店舗名 <Text style={styles.optional}>任意</Text>
          </Text>
          <TextInput
            style={styles.input}
            placeholder="例: ○○パチンコ"
            value={storeName}
            onChangeText={(text) => { setStoreName(text); setShowStoreSuggestions(true); }}
            onFocus={() => setShowStoreSuggestions(true)}
            onBlur={() => setTimeout(() => setShowStoreSuggestions(false), 200)}
            returnKeyType="next"
          />
          {showStoreSuggestions && storeNameHistory.filter((n) =>
            n.toLowerCase().includes(storeName.toLowerCase())
          ).length > 0 && (
            <View style={styles.suggestionsContainer}>
              {storeNameHistory
                .filter((n) => n.toLowerCase().includes(storeName.toLowerCase()))
                .map((name, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.suggestionItem}
                    onPress={() => { setStoreName(name); setShowStoreSuggestions(false); }}
                  >
                    <Text style={styles.suggestionText}>{name}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          )}

          {/* 台番号（任意） */}
          <Text style={styles.label}>
            台番号 <Text style={styles.optional}>任意</Text>
          </Text>
          <TextInput
            style={styles.input}
            placeholder="例: 123"
            value={machineNumber}
            onChangeText={setMachineNumber}
            keyboardType="numeric"
            returnKeyType="next"
          />

          {/* 開始時の回転数（必須） */}
          <Text style={styles.label}>
            開始時の回転数 <Text style={styles.required}>必須</Text>
          </Text>
          <Text style={styles.hint}>
            今の台の回転数表示をそのまま入力してください
          </Text>
          <TextInput
            style={styles.inputLarge}
            placeholder="例: 350"
            value={startRotation}
            onChangeText={setStartRotation}
            keyboardType="numeric"
            returnKeyType="done"
          />

          {/* 遊技スタートボタン */}
          <TouchableOpacity style={styles.primaryButton} onPress={handleStartSession}>
            <Text style={styles.primaryButtonText}>遊技スタート</Text>
          </TouchableOpacity>

          {/* 戻るボタン */}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              resetForm();
              setScreen('home');
            }}
          >
            <Text style={styles.secondaryButtonText}>戻る</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // 編集画面（edit）
  // ========================================
  if (screen === 'edit') {
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
            onChangeText={(v) => updateEditDraft('machineName', v)} />

          <Text style={styles.label}>店舗名</Text>
          <TextInput style={styles.input} value={editDraft.storeName}
            onChangeText={(v) => updateEditDraft('storeName', v)} />

          <Text style={styles.label}>台番号</Text>
          <TextInput style={styles.input} value={editDraft.machineNumber}
            onChangeText={(v) => updateEditDraft('machineNumber', v)}
            keyboardType="numeric" />

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

          <TouchableOpacity style={styles.primaryButton} onPress={handleSaveEdit}>
            <Text style={styles.primaryButtonText}>保存する</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('home')}>
            <Text style={styles.secondaryButtonText}>キャンセル</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // 設定画面（settings）
  // ========================================
  if (screen === 'settings') {
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
          <Text style={styles.hint}>例: 250（250玉あたりの回転数で計算）</Text>
          <TextInput
            style={styles.input}
            value={draftRateBalls}
            onChangeText={setDraftRateBalls}
            keyboardType="numeric"
            returnKeyType="done"
          />

          {/* 使用玉数ボタンの値 */}
          <Text style={styles.label}>使用玉数ボタンの値（3つ）</Text>
          <Text style={styles.hint}>遊技中に表示される＋ボタンの加算量</Text>
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
          <Text style={styles.hint}>遊技中に表示される＋ボタンの加算量</Text>
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

          <TouchableOpacity style={styles.primaryButton} onPress={handleSaveSettings}>
            <Text style={styles.primaryButtonText}>保存する</Text>
          </TouchableOpacity>
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
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('home')}>
            <Text style={styles.secondaryButtonText}>キャンセル</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========================================
  // リセット入力画面（reset）
  // ========================================
  if (screen === 'reset') {
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
          placeholder="例: 0"
          value={newResetRotation}
          onChangeText={setNewResetRotation}
          keyboardType="numeric"
          autoFocus
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleConfirmReset}>
          <Text style={styles.primaryButtonText}>継続する</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('playing')}>
          <Text style={styles.secondaryButtonText}>キャンセル（遊技中に戻る）</Text>
        </TouchableOpacity>
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

        {/* リセットして継続ボタン */}
        <TouchableOpacity style={styles.resetButton} onPress={handleOpenReset}>
          <Text style={styles.resetButtonText}>リセットして継続</Text>
        </TouchableOpacity>

      </View>

      {/* ===== 下部固定: 終了・中断ボタン ===== */}
      <View style={styles.playingFooter}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleEndSession}>
          <Text style={styles.primaryButtonText}>遊技終了・保存</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={handleAbort}>
          <Text style={styles.secondaryButtonText}>中断する（保存しない）</Text>
        </TouchableOpacity>
      </View>

    </KeyboardAvoidingView>
  );
}

// ========================================
// スタイル定義
// ========================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#1a1a2e',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: '#888',
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
    color: '#aaa',
    marginBottom: 8,
  },
  emptySubText: {
    fontSize: 14,
    color: '#bbb',
  },

  // ホームヘッダー（タイトル + 設定ボタン）
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    position: 'relative',
  },
  settingsButton: {
    position: 'absolute',
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  settingsButtonText: {
    fontSize: 13,
    color: '#555',
  },

  // 設定画面
  settingsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  settingsInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
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
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 18,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
  },
  dateInputYear: {
    flex: 1.5,
  },
  dateSeparator: {
    fontSize: 18,
    color: '#888',
  },
  // 時刻入力（時:分）
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    fontSize: 18,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
  },
  timeSeparator: {
    fontSize: 18,
    color: '#888',
  },

  // 入力候補リスト
  suggestionsContainer: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginTop: 2,
    marginBottom: 4,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  suggestionText: {
    fontSize: 15,
    color: '#333',
  },

  resetDefaultButton: {
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ffcdd2',
    backgroundColor: '#fff0f0',
  },
  resetDefaultButtonText: {
    fontSize: 14,
    color: '#e53935',
  },

  // セッションカード
  listContent: {
    paddingBottom: 16,
  },
  sessionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sessionDate: {
    fontSize: 12,
    color: '#aaa',
  },
  sessionTime: {
    fontSize: 12,
    color: '#aaa',
  },
  sessionStore: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  sessionMachine: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#1a1a2e',
    marginBottom: 12,
  },
  // 統計の横並び
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  // 玉あたり回転だけ色を変える
  rateItem: {
    backgroundColor: '#eef4ff',
    borderRadius: 8,
    paddingVertical: 4,
  },
  rateValue: {
    color: '#3a86ff',
    fontSize: 17,
  },

  // フォーム共通
  label: {
    fontSize: 14,
    color: '#555',
    marginTop: 18,
    marginBottom: 6,
  },
  required: {
    color: '#ff4757',
    fontSize: 12,
  },
  optional: {
    color: '#aaa',
    fontSize: 12,
  },
  hint: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 6,
    marginTop: -4,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  // 遊技中画面用の大きい入力欄
  inputLarge: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    fontSize: 28,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
    color: '#1a1a2e',
  },

  // 遊技中画面のルートコンテナ
  playingContainer: {
    flex: 1,
    backgroundColor: '#f0f4f8',
    paddingTop: 44,
  },

  // 遊技中画面の入力エリア全体
  playingContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    justifyContent: 'space-between',
  },

  // 遊技中画面の下部固定フッター
  playingFooter: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#dde4ee',
    backgroundColor: '#f0f4f8',
  },

  playingStoreName: {
    fontSize: 11,
    color: '#7a9acc',
    marginBottom: 1,
  },
  playingMachineName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#aac4ff',
    marginBottom: 4,
  },
  playingLabel: {
    fontSize: 13,
    color: '#555',
    fontWeight: 'bold',
  },

  // 遊技中の入力欄
  playingInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    height: 62,
    fontSize: 28,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
    color: '#1a1a2e',
  },

  // ボタン行（+/- 共通の横並び）
  btnRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  // 加算ボタン（青・減算の2倍の高さ）
  btnIncrement: {
    flex: 1,
    height: 64,
    backgroundColor: '#e8f0fe',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c5d8ff',
  },
  btnIncrementText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3a86ff',
  },
  // 減算ボタン（赤・加算の半分の高さ）
  btnDecrement: {
    flex: 1,
    height: 32,
    backgroundColor: '#fff0f0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  btnDecrementText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#e53935',
  },

  // リセットして継続ボタン
  resetButton: {
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#f0a500',
    backgroundColor: '#fffbf0',
    marginTop: 8,
  },
  resetButtonText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#f0a500',
  },

  // 区切り線
  divider: {
    height: 1,
    backgroundColor: '#dde4ee',
    marginVertical: 10,
  },

  // 遊技中画面の上部エリア
  rateDisplay: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  rateDisplayValue: {
    fontSize: 44,
    fontWeight: 'bold',
    color: '#fff',
    lineHeight: 52,
  },
  rateUnit: {
    fontSize: 12,
    color: '#aac4ff',
    marginTop: 2,
  },

  // 総回転数・総使用玉数の横並び表示
  totalRow: {
    flexDirection: 'row',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#2e3a5a',
    width: '100%',
  },
  totalItem: {
    flex: 1,
    alignItems: 'center',
  },
  totalDivider: {
    width: 1,
    backgroundColor: '#2e3a5a',
  },
  totalLabel: {
    fontSize: 11,
    color: '#aac4ff',
    marginBottom: 2,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },

  // ボタン（ホーム・setup 画面共通）
  primaryButton: {
    backgroundColor: '#3a86ff',
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButton: {
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: '#aaa',
    fontSize: 14,
  },
});
