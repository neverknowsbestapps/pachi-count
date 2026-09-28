// ストアのレビュー依頼（expo-store-review）
//
// 記録を3回目に保存した直後に、OS のレビューダイアログを一度だけ出す。
// 出したかどうかと保存回数は AsyncStorage に持ち、一度出したら二度と出さない。
// ブラウザでは隣の review.web.js が使われ、何もしない。

import AsyncStorage from '@react-native-async-storage/async-storage';

let StoreReview = null;
try {
  StoreReview = require('expo-store-review');
} catch (e) {
  StoreReview = null;
}

// 保存回数と表示済みフラグの保存先（アプリ名を変えても据え置く）
const REVIEW_KEY = '@rotation_review_v1';

// 何回目の保存でレビューを頼むか
const REQUEST_AT_SAVE_COUNT = 3;

// 記録を保存するたびに呼ぶ。条件がそろえばレビューダイアログを出す。
// 失敗しても記録の保存には影響させないので、例外はすべて握りつぶす。
export async function noteSessionSavedAndMaybeRequestReview() {
  try {
    const raw = await AsyncStorage.getItem(REVIEW_KEY);
    const state = raw ? JSON.parse(raw) : { saveCount: 0, requested: false };
    state.saveCount = (state.saveCount || 0) + 1;
    await AsyncStorage.setItem(REVIEW_KEY, JSON.stringify(state));

    if (state.requested) return;
    if (state.saveCount < REQUEST_AT_SAVE_COUNT) return;
    if (!StoreReview) return;

    // レビュー機能が使えない環境（TestFlight・ストア未導入端末など）では出さない
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;
    const canAsk = await StoreReview.hasAction();
    if (!canAsk) return;

    await StoreReview.requestReview();
    state.requested = true;
    await AsyncStorage.setItem(REVIEW_KEY, JSON.stringify(state));
  } catch (_) {
    // 出せなくても何もしない
  }
}
