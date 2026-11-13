// 計算と検査（logic.js）の自動テスト。部品は足さず、Node に付いているテストの仕組みを使う。
//
//   node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDate, formatTime, onlyDigits, calcRate, calcDuration,
  checkPlaying, checkReset, sortSessions, buildExportText, parseImportedSessions,
} from '../logic.js';

const playing = (over) => ({
  startRotation: '100',
  endRotation: '200',
  ballsUsed: '250',
  accumulatedRotations: 0,
  accumulatedBalls: 0,
  ...over,
});

const session = (over) => ({
  id: '1',
  date: '2026/5/26',
  startTime: '14:30',
  endTime: '17:45',
  machineName: '',
  storeName: '',
  machineNumber: '',
  startRotation: 0,
  endRotation: 100,
  rotations: 100,
  ballsUsed: 250,
  memo: '',
  ...over,
});

test('日付と時刻の文字は決まった形になる', () => {
  assert.equal(formatDate(new Date(2026, 4, 6, 0, 5)), '2026/5/6');
  assert.equal(formatTime(new Date(2026, 4, 6, 0, 5)), '00:05');
  assert.equal(formatTime(new Date(2026, 4, 6, 14, 30)), '14:30');
});

test('数字の欄には数字だけが残る', () => {
  assert.equal(onlyDigits('1,000'), '1000');
  assert.equal(onlyDigits('-3.5'), '35');
  assert.equal(onlyDigits('１２３'), '123');
  assert.equal(onlyDigits('abc'), '');
});

test('回転率は基準玉数あたりの回転数', () => {
  assert.equal(calcRate(100, 250, 250), '100.0');
  assert.equal(calcRate(100, 250, 200), '80.0');
  assert.equal(calcRate(57, 1000, 250), '14.3');
  assert.equal(calcRate(100, 0, 250), '--');
  assert.equal(calcRate(0, 250, 250), '--');
});

test('所要時間。終了が開始より前なら翌日とみなす', () => {
  assert.equal(calcDuration('14:30', '17:45'), '3時間15分');
  assert.equal(calcDuration('22:00', '0:30'), '2時間30分');
  assert.equal(calcDuration('--', '17:45'), '');
});

test('保存：ふつうの1区間', () => {
  assert.deepEqual(checkPlaying(playing()), {
    startRotationNum: 100, endRotationNum: 200, rotationsNum: 100, totalBallsNum: 250,
  });
});

test('保存：開始回転数が 0 でも通る', () => {
  const v = checkPlaying(playing({ startRotation: '0', endRotation: '50' }));
  assert.equal(v.rotationsNum, 50);
});

test('保存：最初の区間は入力がそろっていないと止める', () => {
  assert.ok(checkPlaying(playing({ startRotation: '' })).error);
  assert.ok(checkPlaying(playing({ ballsUsed: '' })).error);
  assert.ok(checkPlaying(playing({ ballsUsed: '0' })).error);
  assert.ok(checkPlaying(playing({ endRotation: '' })).error);
  assert.ok(checkPlaying(playing({ endRotation: '50' })).error);
  assert.ok(checkPlaying(playing({ endRotation: '100' })).error); // 0 回転
});

test('保存：リセット直後は今の区間が空でも累積で保存できる', () => {
  const v = checkPlaying(playing({
    startRotation: '0', endRotation: '', ballsUsed: '0',
    accumulatedRotations: 100, accumulatedBalls: 250,
  }));
  assert.deepEqual(v, {
    startRotationNum: 0, endRotationNum: 0, rotationsNum: 100, totalBallsNum: 250,
  });
});

test('保存：累積に今の区間を足す', () => {
  const v = checkPlaying(playing({
    startRotation: '0', endRotation: '80', ballsUsed: '125',
    accumulatedRotations: 100, accumulatedBalls: 250,
  }));
  assert.equal(v.rotationsNum, 180);
  assert.equal(v.totalBallsNum, 375);
});

test('リセット：今の区間の回転数と玉数をまとめる', () => {
  assert.deepEqual(
    checkReset({ startRotation: '100', endRotation: '200', ballsUsed: '250' }),
    { segmentRotations: 100, segmentBalls: 250 }
  );
});

test('リセット：玉を使っているのに回転数が空なら止める', () => {
  assert.ok(checkReset({ startRotation: '100', endRotation: '', ballsUsed: '250' }).error);
  assert.ok(checkReset({ startRotation: '100', endRotation: '50', ballsUsed: '250' }).error);
});

test('リセット：何も入れていない区間はそのまま通る', () => {
  assert.deepEqual(
    checkReset({ startRotation: '0', endRotation: '', ballsUsed: '0' }),
    { segmentRotations: 0, segmentBalls: 0 }
  );
  assert.deepEqual(
    checkReset({ startRotation: '0', endRotation: '', ballsUsed: '' }),
    { segmentRotations: 0, segmentBalls: 0 }
  );
});

test('一覧は新しい日付が上。同じ日は開始時刻、同じ時刻は作った順', () => {
  const list = [
    session({ id: '1', date: '2026/5/26', startTime: '10:00' }),
    session({ id: '2', date: '2026/11/3', startTime: '9:00' }),
    session({ id: '3', date: '2026/5/26', startTime: '18:00' }),
    session({ id: '4', date: '2026/5/26', startTime: '18:00' }),
    session({ id: '5', date: '2025/12/31', startTime: '--' }),
  ];
  assert.deepEqual(sortSessions(list).map((s) => s.id), ['2', '4', '3', '1', '5']);
  // 元の配列は並べ替えない
  assert.deepEqual(list.map((s) => s.id), ['1', '2', '3', '4', '5']);
});

test('書き出したデータはそのまま取り込める', () => {
  const list = [session({ id: '1' }), session({ id: '2', memo: 'メモ' })];
  assert.deepEqual(parseImportedSessions(buildExportText(list)), list);
});

test('取り込み：記録の配列そのものも受け付け、余計な項目は落とす', () => {
  const got = parseImportedSessions(JSON.stringify([{ ...session(), extra: 1 }]));
  assert.deepEqual(got, [session()]);
});

test('取り込み：形のおかしいデータは丸ごと断る', () => {
  const bad = (over) => parseImportedSessions(JSON.stringify([session(over)]));
  assert.equal(parseImportedSessions('こんにちは'), null);
  assert.equal(parseImportedSessions('[]'), null);
  assert.equal(parseImportedSessions('{"sessions":"x"}'), null);
  assert.equal(bad({ id: 5 }), null);
  assert.equal(bad({ date: '2026-05-26' }), null);
  assert.equal(bad({ startTime: '午後2:30' }), null);
  assert.equal(bad({ rotations: -1 }), null);
  assert.equal(bad({ ballsUsed: '250' }), null);
  assert.equal(bad({ memo: 'あ'.repeat(201) }), null);
  assert.equal(
    parseImportedSessions(JSON.stringify([session({ id: '1' }), session({ id: '1' })])),
    null
  );
});
