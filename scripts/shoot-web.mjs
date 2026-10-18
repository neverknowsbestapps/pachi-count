// Web 版を headless Chrome で開き、ストア用の素のスクショを撮る（CDP を直接使う）
// Web 版（npx expo start --web）を立ち上げてから: node scripts/shoot-web.mjs http://localhost:8081 assets/store/raw/<版>
// 360x800・3倍で撮るので 1080x2400 になる。記録・設定・途中経過はこの中の例のデータを入れる
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'pc-shoot-'));
const port = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--lang=ja-JP', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

const sessions = [
  { id: '1790582400000', date: '2026/10/18', startTime: '18:10', endTime: '18:52', machineName: 'Pパチカウント甘Ver', storeName: 'パーラーNKB', machineNumber: '222', startRotation: 0, endRotation: 320, rotations: 320, ballsUsed: 3875, memo: '' },
  { id: '1790578800000', date: '2026/10/18', startTime: '16:07', endTime: '17:40', machineName: 'eパチカウント物語', storeName: 'パーラーNKB', machineNumber: '333', startRotation: 0, endRotation: 333, rotations: 333, ballsUsed: 4250, memo: '' },
];
const playing = {
  machineName: 'eパチカウント物語', storeName: 'パーラーNKB', machineNumber: '333', startRotation: '0', memo: '',
  ballsUsed: '4250', endRotation: '333', startTime: new Date(Date.now() - 93 * 60000).toISOString(),
  accumulatedRotations: 0, accumulatedBalls: 0, continueId: null,
};
const store = {
  '@rotation_sessions_v3': JSON.stringify(sessions),
  '@rotation_settings_v1': JSON.stringify({ rateBalls: 250, ballButtons: [125, 250, 1000], rotationButtons: [1, 10, 100], theme: 'light' }),
  '@rotation_names_v1': JSON.stringify({ machineNames: ['eパチカウント物語', 'Pパチカウント甘Ver'], storeNames: ['パーラーNKB'] }),
  '@rotation_review_v1': JSON.stringify({ count: 99, shown: true }),
};

const load = async (withPlaying) => {
  await send('Page.navigate', { url });
  await sleep(4000);
  const all = { ...store, ...(withPlaying ? { '@rotation_playing_v1': JSON.stringify(playing) } : {}) };
  await evaluate(`localStorage.clear(); ${Object.entries(all).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')} true`);
  await send('Page.reload');
  await sleep(5000);
};
const shot = async (name) => {
  await sleep(1200);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
};
// 指定の文字を表示している一番内側の要素の中心を押す
const tap = async (text, nth = 0) => {
  const pos = await evaluate(`(() => {
    const els = [...document.querySelectorAll('div,span')].filter(e => e.textContent.trim() === ${JSON.stringify(text)} && e.offsetParent !== null);
    const inner = els.filter(e => !els.some(o => o !== e && e.contains(o)));
    const e = inner[${nth}]; if (!e) return null;
    const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
  if (!pos) throw new Error('not found: ' + text);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  }
  await sleep(800);
};

await load(true);
await shot('01-playing.png');
await load(false);
await shot('03-home.png');
await tap('eパチカウント物語（333番台）');
await shot('02-detail.png');
await load(false);
await tap('設定');
await shot('04-settings.png');

ws.close();
chrome.kill();
process.exit(0);
