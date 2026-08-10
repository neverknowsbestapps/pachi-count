// App Store 用のスクリーンショットを作る。
//
// iPhone で撮った画像（1170×2532）を、App Store Connect が受け付ける
// 1284×2778 に拡大して、透過なしの PNG で書き出す。
// Apple は透過（アルファチャンネル）を含む画像を弾くので、そこだけ注意。
//
// 使い方（元画像を assets/store/ios/original に置いてから）:
//   node scripts/make-ios-screenshots.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp-compact';
import pkg from 'pngjs';

const { PNG } = pkg;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// App Store Connect の「iPhone 6.5インチディスプレイ」枠のサイズ
const WIDTH = 1284;
const HEIGHT = 2778;

// 元画像 → 出力名。ストアに並ぶ順番でもある
const SHOTS = [
  { from: 'IMG_0007.PNG', to: 'ios-01-home.png' },      // ホーム（記録一覧）
  { from: 'IMG_0008.PNG', to: 'ios-02-playing.png' },   // 遊技中
  { from: 'IMG_0010.PNG', to: 'ios-03-detail.png' },    // 記録の詳細（撮り直したもの）
  { from: 'IMG_0009.PNG', to: 'ios-04-settings.png' },  // 設定
];

const srcDir = resolve(root, 'assets/store/ios/original');
const outDir = resolve(root, 'assets/store/ios');
mkdirSync(outDir, { recursive: true });

for (const shot of SHOTS) {
  const image = await Jimp.read(readFileSync(resolve(srcDir, shot.from)));
  image.resize(WIDTH, HEIGHT, Jimp.RESIZE_BICUBIC);

  // jimp は RGBA で持っているので、アルファを白で潰して RGB の PNG にする
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  const src = image.bitmap.data;
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    for (let c = 0; c < 3; c += 1) {
      png.data[i + c] = Math.round(src[i + c] * a + 255 * (1 - a));
    }
    png.data[i + 3] = 255;
  }

  const outPath = resolve(outDir, shot.to);
  writeFileSync(outPath, PNG.sync.write(png, { colorType: 2 }));
  console.log(`${shot.from} -> ${shot.to} (${WIDTH}x${HEIGHT})`);
}
