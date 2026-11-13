// 画面を持たない計算と検査だけを集めたファイル。
//
// App.js から切り出しているのは、自動テスト（tests/logic.test.mjs）で確かめるため。
// App.js は React Native の部品を読み込むので、テストからは直接読めない。
// ここには React・React Native・保存先（AsyncStorage）を持ち込まないこと。
//
//   node --test tests/

// 日付（"2026/5/26"）と時刻（"14:05"）の文字を作る。
// 端末の書式まかせにすると設定次第で形が変わり、編集や取り込みで読めなくなるため自前で組み立てる
export const pad2 = (n) => String(n).padStart(2, '0');
export const formatDate = (d) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
export const formatTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// 数字の入力欄に入れる文字を数字だけにする（全角の数字は半角に直し、「-」「.」「,」などは落とす）
export const onlyDigits = (v) =>
  String(v)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[^0-9]/g, '');

// 回転率（基準玉数あたりの回転数）を小数1桁の文字で返す。計算できないときは '--'
export const calcRate = (rotations, ballsUsed, rateBalls) =>
  ballsUsed > 0 && rotations > 0
    ? ((rotations / ballsUsed) * rateBalls).toFixed(1)
    : '--';

// 開始時刻〜終了時刻から所要時間を計算（"HH:MM" 文字列）
export const calcDuration = (start, end) => {
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

// 遊技中の入力から、保存する数値をまとめる。保存できないときは { error: 警告文 } を返す。
// リセット（大当たり）や「続きから遊技」の直後は、それまでの累積がある。
// その場合は今の区間が空でも保存できる（空の欄は「この区間は 0」とみなす）
export const checkPlaying = ({
  startRotation, endRotation, ballsUsed, accumulatedRotations, accumulatedBalls,
}) => {
  const ballsNum = parseInt(ballsUsed, 10);
  const parsedEndRotation = parseInt(endRotation, 10);
  const startRotationNum = parseInt(startRotation, 10);

  if (isNaN(startRotationNum)) return { error: '開始時の回転数を入力してください' };

  const segmentBalls = isNaN(ballsNum) ? 0 : ballsNum;
  if (segmentBalls < 0 || accumulatedBalls + segmentBalls <= 0) {
    return { error: '使用玉数を入力してください' };
  }
  const endMissing = !String(endRotation).trim() || isNaN(parsedEndRotation);
  if (endMissing && accumulatedRotations <= 0) {
    return { error: '現在の回転数を入力してください' };
  }
  const endRotationNum = endMissing ? startRotationNum : parsedEndRotation;
  if (endRotationNum < startRotationNum) {
    return { error: '現在の回転数は開始時の値より大きい値を入力してください' };
  }

  // 合計回転数・合計玉数（累積 + 現セグメント）
  const rotationsNum = accumulatedRotations + (endRotationNum - startRotationNum);
  const totalBallsNum = accumulatedBalls + segmentBalls;
  if (rotationsNum <= 0) {
    return { error: '回転数が0回です。回転していない場合は中断してください' };
  }
  return { startRotationNum, endRotationNum, rotationsNum, totalBallsNum };
};

// リセット（大当たり）の前に、今の区間の回転数・玉数をまとめる。
// この区間の回転数が分からないまま玉数だけを累積すると、回転率が実際より低くなる。
// 玉を使っているのに現在の回転数が空・開始より小さいときは { error: 警告文 } を返す
export const checkReset = ({ startRotation, endRotation, ballsUsed }) => {
  const parsedEnd = parseInt(endRotation, 10);
  const parsedStart = parseInt(startRotation, 10);
  const parsedBalls = parseInt(ballsUsed, 10);
  const segmentBalls = isNaN(parsedBalls) ? 0 : Math.max(0, parsedBalls);
  if (isNaN(parsedEnd) && segmentBalls > 0) {
    return { error: '現在の回転数を入力してください' };
  }
  if (!isNaN(parsedEnd) && !isNaN(parsedStart) && parsedEnd < parsedStart) {
    return { error: '現在の回転数は開始時の値より大きい値を入力してください' };
  }
  const segmentRotations =
    !isNaN(parsedEnd) && !isNaN(parsedStart) ? parsedEnd - parsedStart : 0;
  return { segmentRotations, segmentBalls };
};

// 記録を新しい順（日付 → 開始時刻 → 作った順）に並べた新しい配列を返す。
// 保存先の並びは変えず、一覧に出すときにだけ使う
export const sortSessions = (sessions) => {
  const dateKey = (s) => {
    const [y, m, d] = String(s.date || '').split('/').map(Number);
    return [y, m, d].some(isNaN) ? 0 : y * 10000 + m * 100 + d;
  };
  const timeKey = (s) => {
    const [h, m] = String(s.startTime || '').split(':').map(Number);
    return [h, m].some(isNaN) ? -1 : h * 60 + m;
  };
  const idKey = (s) => {
    const n = Number(s.id);
    return isFinite(n) ? n : 0;
  };
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) =>
      dateKey(b.s) - dateKey(a.s) ||
      timeKey(b.s) - timeKey(a.s) ||
      idKey(b.s) - idKey(a.s) ||
      a.i - b.i
    )
    .map((x) => x.s);
};

// 書き出すデータの文字を作る
export const buildExportText = (sessions) =>
  JSON.stringify({ app: 'pachi-count', version: 1, sessions });

// 取り込む文字を検査して、記録の配列にして返す（取り込めない中身なら null）
// 書き出した形（{ sessions: [...] }）と、記録の配列そのものの両方を受け付ける
export const parseImportedSessions = (text) => {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return null;
  }
  const list = Array.isArray(data)
    ? data
    : (data && Array.isArray(data.sessions) ? data.sessions : null);
  if (!list || list.length === 0) return null;

  const isCount = (v) => typeof v === 'number' && isFinite(v) && v >= 0;
  const isText = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);
  const isTime = (v) => v === '--' || (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v));
  const ids = new Set();
  const result = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.id !== 'string' || s.id === '' || ids.has(s.id)) return null;
    if (typeof s.date !== 'string' || !/^\d{1,4}\/\d{1,2}\/\d{1,2}$/.test(s.date)) return null;
    if (!isTime(s.startTime) || !isTime(s.endTime)) return null;
    if (!isCount(s.rotations) || !isCount(s.ballsUsed)) return null;
    if (s.startRotation !== undefined && !isCount(s.startRotation)) return null;
    if (s.endRotation !== undefined && !isCount(s.endRotation)) return null;
    if (!isText(s.machineName, 50) || !isText(s.storeName, 50)) return null;
    if (!isText(s.machineNumber, 5) || !isText(s.memo, 200)) return null;
    ids.add(s.id);
    // 知っている項目だけを取り出す（余計な項目は持ち込まない）
    result.push({
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      machineName: s.machineName || '',
      storeName: s.storeName || '',
      machineNumber: s.machineNumber || '',
      startRotation: s.startRotation,
      endRotation: s.endRotation,
      rotations: s.rotations,
      ballsUsed: s.ballsUsed,
      memo: s.memo || '',
    });
  }
  return result;
};
