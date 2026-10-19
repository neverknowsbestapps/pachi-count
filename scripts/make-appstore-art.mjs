// App Store のプロダクトページのヘッダ（21:9）と検索結果（3:2）の画像を、言語ごとに画面なしの Edge で
// appstore-art.html から描き出す。追加の依存なし。字は Google Fonts から読むので、ネットにつながった状態で走らせる。
// アプリの根から PowerShell で（Bash からだと Edge がすぐ終わって写らない）:
//   node tools/make-appstore-art.mjs tools/appstore-art.json
// 書き出し: <out>/header-<言語>-3840x1646.png・search-<言語>-2880x1920.png・appstore-check-<言語>.png（確認用。上げない）
//
// 設定（パスはアプリの根から）:
// {
//   "out": "docs/store/assets",
//   "colors": { "bg": "#13203b", "name": "#ffffff", "tag": "#ffffff", "em": "#ffd23f" },   // em は一言の [ ] で囲んだ所の色。plate の色も足せる（無ければ地を 24% 明るく）
//   "frame": "device",   // 画面と地の境目: none / border（白い縁）/ device（端末の縁）/ plate（画面の側の地を明るく）/ glow
//   "langs": {
//     "ja": {
//       "name": "パチカウント",
//       "header": "回転数を記録して\n回転率を自動計算",
//       "search": "回転数を記録して\n回転率を自動計算",
//       "headerScreens": [{ "src": "assets/raw/01.png", "top": 0.04 }],   // 1〜2 枚。top は上から切る割合
//       "searchScreens": [{ "src": "assets/raw/01.png", "top": 0.04 }]    // 1 枚
//     }
//   }
// }
// 横長の画面（ゲームなど）は 1 枚だけにすると、ヘッダは右半分、検索結果は下に丸ごと置く。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const configPath = resolve(process.argv[2] ?? 'tools/appstore-art.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const root = process.cwd();
const page = pathToFileURL(resolve(import.meta.dirname, 'appstore-art.html')).href;
const outDir = resolve(root, config.out);
const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!edge) {
  console.error('Edge が見つからない');
  process.exit(1);
}

// PNG の幅と高さを頭から読む
function pngSize(file) {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
function screens(list) {
  return list.map((s) => {
    const file = resolve(root, s.src);
    const [w, h] = pngSize(file);
    return { src: pathToFileURL(file).href, top: s.top ?? 0, aspect: w / h, landscape: w > h };
  });
}

function shoot(url, w, h, out) {
  execFileSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    // 開いている普段の Edge に吸い込まれないよう、別の置き場で立ち上げる
    `--user-data-dir=${join(tmpdir(), 'appstore-art-edge')}`,
    `--window-size=${w},${h}`,
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    '--virtual-time-budget=15000',
    `--screenshot=${out}`,
    url,
  ], { stdio: 'ignore', timeout: 120_000 });
  console.log(`${out} ${statSync(out).size} bytes`);
}

const sizes = { header: [3840, 1646], search: [2880, 1920] };
for (const [lang, t] of Object.entries(config.langs)) {
  const made = {};
  for (const [kind, [w, h]] of Object.entries(sizes)) {
    const c = {
      kind, lang, colors: config.colors, frame: config.frame, name: t.name, tag: t[kind],
      screens: screens(kind === 'header' ? t.headerScreens : t.searchScreens),
    };
    const out = resolve(outDir, `${kind}-${lang}-${w}x${h}.png`);
    shoot(`${page}#${encodeURIComponent(JSON.stringify(c))}`, w, h, out);
    made[kind] = pathToFileURL(out).href;
  }
  // 確認用: ヘッダを iPhone の幅（390pt を 3 倍）に、検索結果を 365pt を 3 倍に縮めて並べる
  const check = join(tmpdir(), `appstore-check-${lang}.html`);
  writeFileSync(check, `<!doctype html><body style="margin:0;padding:40px;background:#f2f2f7">
<img src="${made.header}" style="display:block;width:1170px">
<img src="${made.search}" style="display:block;width:1095px;margin-top:40px;border-radius:30px">
</body>`);
  shoot(pathToFileURL(check).href, 1250, 40 + 502 + 40 + 730 + 40, resolve(outDir, `appstore-check-${lang}.png`));
}
console.log(`設定: ${dirname(configPath)}`);
