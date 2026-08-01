// ブラウザでは広告を出さない。
// 広告ライブラリはネイティブ専用で、web のバンドルに含めると失敗するため、
// ここでは読み込まずに「何もしない」中身を返す（ads.js の説明も参照）。

export const USE_TEST_ADS = true;

export async function initAds() {}

export function AdBanner() {
  return null;
}
