// アプリの「ライセンス」画面に出す一覧（licenses.js）を作る
//
// package.json の dependencies に並ぶ部品について、node_modules にある
// LICENSE ファイルの全文を集める。部品を足したり版を上げたりしたら作り直す。
//
//   node scripts/make-licenses.mjs
//
// ライセンスのファイルが見つからない部品があれば、止めて知らせる。

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const entries = Object.keys(pkg.dependencies).sort().map((name) => {
  const dir = join(root, 'node_modules', name);
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  // LICENSE / LICENSE_FONT（フォントの OFL）など、名前が LICENSE で始まるものを全部つなぐ
  const files = readdirSync(dir).filter((f) => /^licen[cs]e/i.test(f)).sort();
  if (files.length === 0) throw new Error(`${name} にライセンスのファイルがありません`);
  const text = files
    .map((f) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .join('\n\n');
  return { name, version: meta.version, license: meta.license || '', text };
});

const out =
  '// このファイルは scripts/make-licenses.mjs が作る。手で直さない\n' +
  '// アプリが使っている部品とライセンスの全文（設定 → このアプリについて → ライセンス）\n\n' +
  `export const LICENSES = ${JSON.stringify(entries, null, 2)};\n`;
writeFileSync(join(root, 'licenses.js'), out);
console.log(`licenses.js に ${entries.length} 件を書き出しました`);
