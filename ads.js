// 広告（AdMob）— Android は本番の広告、iOS はまだ未設定。
//
// App.js に直接書かずファイルを分けているのは、環境ごとに「読み込まない」を
// 作る必要があるため。
//   - ブラウザ … 隣の ads.web.js が使われる（Metro が拡張子で選ぶ）。
//     広告ライブラリはネイティブ専用で、web のバンドルに含めると失敗する
//   - Expo Go … ライブラリのネイティブ部分が入っていないので、require の
//     時点で例外になる。それを捕まえて「広告なし」で動かす
// つまり広告が実際に出るのは、EAS でビルドしたアプリだけ。
//
// 本番の広告を出すときは USE_TEST_ADS を false にして UNIT_IDS を埋め、
// app.json のアプリIDも AdMob の本物に差し替える。
//
// ライブラリのバージョンは 16.0.0 に固定する（package.json で ^ を付けない）。
// 16.1.0 以降が使う Google の広告SDK は Kotlin 2.2/2.3 で作られていて、
// Expo SDK 56（Kotlin 2.1）ではビルドが通らない。

import { useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

let ads = null;
try {
  ads = require('react-native-google-mobile-ads');
} catch (e) {
  ads = null;
}

// テスト広告を使うかどうか。
// true にすると、どの端末でもテスト広告（「Test Ad」と出るもの）に戻る。
// 動作を試すときはここを true に戻すこと（本物の広告を自分で触らないため）。
export const USE_TEST_ADS = false;

// 本番のバナー広告ユニットID（AdMob で作ったもの）。
const UNIT_IDS = {
  android: 'ca-app-pub-5570948445738089/1322458553',
  ios: 'ca-app-pub-5570948445738089/8892920250',
};

function bannerUnitId() {
  if (!ads) return null;
  if (USE_TEST_ADS) return ads.TestIds.BANNER;
  return UNIT_IDS[Platform.OS] || null;
}

// 広告が出ない原因を端末で見るための調査用スイッチ。
// true にすると、読み込みに失敗したときのエラー内容を画面に出す。
// 利用者に見せるものではないので、調べ終わったら必ず false に戻すこと。
export const SHOW_AD_DEBUG = false;

// 同意が取れていて広告を出してよいか。日本など同意が不要な地域では最初から true
let canRequestAds = true;

// mobileAds().initialize() が済んだか。
// 済む前に広告を読みに行くと動かないので、バナーはこれが立ってから出す。
let initialized = false;

// 初期化が済んだことをバナーに知らせる仕組み。
// バナーはアプリ起動と同時に描かれるが、初期化は非同期で少し遅れて終わる。
// 知らせないと、初期化前の「まだ出せない」状態のまま止まってしまう。
const listeners = new Set();

function subscribeAds(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((fn) => fn());
}

// バナーを出してよい状態か
function adsReady() {
  return !!ads && initialized && canRequestAds;
}

// アプリ起動時に一度呼ぶ。広告が使えない環境では何もしない。
//
// 順番が決まっている: 同意 → 広告の中身の設定 → 初期化。
// 同意を取る前に初期化すると Google のポリシー違反になる。
export async function initAds() {
  if (!ads) return;

  // 同意（UMP）。EU・英国など必要な地域でだけ画面が出る。
  // 日本からは何も出ないまま「同意は不要」と返ってくる。
  try {
    const info = await ads.AdsConsent.gatherConsent();
    canRequestAds = info.canRequestAds !== false;
  } catch (e) {
    // 通信できないなどで確認できなかったときは、そのまま広告を出す。
    // ここで止めると、同意が要らない地域でも広告が消えてしまうため。
  }
  if (!canRequestAds) {
    notify();
    return;
  }

  try {
    // 出てくる広告の内容の上限。このアプリは成人向け（18+）想定なので
    // MA（お酒・ギャンブルなどを含む）にしている。
    await ads.default().setRequestConfiguration({
      maxAdContentRating: ads.MaxAdContentRating.MA,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });
    await ads.default().initialize();
    initialized = true;
  } catch (e) {
    // 初期化に失敗しても、アプリは広告なしでそのまま動かす
  }
  notify();
}

// 画面の下に出すバナー広告。
// 色は App.js の COLORS を渡してもらう（相互参照を避けるため）。
//
// 広告が読み込めるまで／読み込めなかったときは高さ0にする。
// そうしないと、広告が来なかったときに空っぽの帯だけが残ってしまう。
export function AdBanner({ borderColor, backgroundColor, textColor }) {
  // 初期化が済んだら描き直す
  const ready = useSyncExternalStore(subscribeAds, adsReady, adsReady);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const unitId = bannerUnitId();
  if (!ready || !unitId) {
    // 調査用のときだけ、初期化前で止まっていることが分かるようにする
    if (SHOW_AD_DEBUG && ads && !ready) {
      return (
        <View style={[styles.wrap, { borderTopColor: borderColor, backgroundColor }]}>
          <Text style={[styles.debug, { color: textColor }]}>広告：初期化待ち</Text>
        </View>
      );
    }
    return null;
  }

  if (SHOW_AD_DEBUG && error) {
    return (
      <View style={[styles.wrap, { borderTopColor: borderColor, backgroundColor }]}>
        <Text style={[styles.debug, { color: textColor }]}>広告エラー: {error}</Text>
      </View>
    );
  }

  const { BannerAd, BannerAdSize } = ads;
  return (
    <View
      style={loaded ? [styles.wrap, { borderTopColor: borderColor, backgroundColor }] : styles.empty}
    >
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdLoaded={() => {
          setLoaded(true);
          setError(null);
        }}
        onAdFailedToLoad={(e) => {
          setLoaded(false);
          setError(e?.message || String(e));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 8,
    borderTopWidth: 1,
    alignItems: 'center',
  },
  // 読み込めていない間。場所を取らずに待たせる
  empty: { height: 0, overflow: 'hidden' },
  // 調査用の表示（SHOW_AD_DEBUG が true のときだけ使う）
  debug: { fontSize: 12, textAlign: 'center', paddingHorizontal: 12 },
});
