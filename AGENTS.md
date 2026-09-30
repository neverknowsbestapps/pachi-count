# パチカウント — 開発ガイド

パチンコの**遊技中にリアルタイムで回転数を記録**するモバイルアプリ。
台の回転数表示と使用玉数を入力すると、「○○玉あたりの回転数（回転率）」を自動計算する。

---

## プロジェクト概要

- **目的**: 遊技しながら片手で回転数・使用玉数を記録し、回転率を把握する
- **対象**: パチンコを遊技するユーザー本人
- **方針**: 収支管理は別アプリに任せ、「回転数記録」に特化したシンプルなアプリにする
- **フェーズ1（完成）**: AsyncStorage によるローカル完結 MVP

---

## 技術スタック

- **Expo SDK 56** / React Native 0.85 / React 19
- **JavaScript のみ**（TypeScript は使わない）
- `@react-native-async-storage/async-storage` 2.2.0（ローカル永続化）
- `expo-store-review`（3回目の保存後にレビュー依頼を一度だけ出す。`review.js`）
- 外部UIライブラリ・ナビゲーションライブラリは**使わない**

> ⚠️ Expo はバージョンで API が大きく変わる。コードを書く前に必ず
> https://docs.expo.dev/versions/v56.0.0/ の該当バージョンのドキュメントを確認すること。

---

## 開発コマンド

```bash
# 開発サーバー起動（スマホの Expo Go で QR を読み取る）
npx expo start

# 構文チェック（JSX を含むので @babel/parser で確認する）
node -e "const fs=require('fs');require('@babel/parser').parse(fs.readFileSync('App.js','utf8'),{sourceType:'module',plugins:['jsx']});console.log('SYNTAX OK')"
```

> Node.js は `C:\Program Files\nodejs\` にある。シェルから `node` が見つからない場合はフルパスで実行する。
> npm/npx 系のコマンドは原則ユーザー自身の PowerShell で実行してもらう。

---

## アーキテクチャ

### 単一ファイル構成
すべてのコードは **`App.js`（約2,200行）に集約**されている。意図的に1ファイルで保守している（初心者が全体を把握しやすくするため）。安易にファイル分割しない。

### 画面遷移（React Navigation 不使用）
`screen` という state 1つで画面を切り替える。画面名は `SCREEN` 定数で管理：

| SCREEN | 役割 |
|---|---|
| `HOME` | 記録一覧（カードをタップで詳細へ） |
| `SETUP` | 台情報・開始回転数の入力 |
| `PLAYING` | 遊技中のメイン操作画面 |
| `RESET` | 大当たり後の「リセットして続ける」 |
| `SETTINGS` | 基準玉数・ボタン値のカスタム設定 |
| `DETAIL` | 記録の詳細表示 |
| `EDIT` | 記録の編集 |

### 状態管理
`App()` 内の `useState` 群のみ。グローバル state ライブラリは使わない。

### データの永続化（AsyncStorage キー）
- `@rotation_sessions_v3` — セッション記録の配列
- `@rotation_settings_v1` — ユーザー設定（基準玉数・ボタン値）
- `@rotation_names_v1` — 機種名・店舗名の入力履歴
- `@rotation_playing_v1` — 遊技中の途中経過。値が変わるたびに書き、起動時にあれば遊技中画面へ復帰する。保存・中断で消す
- `@rotation_review_v1` — レビュー依頼の保存回数と表示済みフラグ（`review.js`）
- `@rotation_onboarding_v1` — 初回起動の案内を表示済みなら `'1'`（記録が1件以上あれば案内を出さずに立てる）

---

## データモデル（1セッション）

```js
{
  id,            // Date.now().toString()
  date,          // "2026/5/26"
  startTime,     // "14:30"
  endTime,       // "17:45"
  machineName,   // 機種名（任意）
  storeName,     // 店舗名（任意）
  machineNumber, // 台番号（任意）
  startRotation, // 開始時の台の回転数
  endRotation,   // 終了時の台の回転数
  rotations,     // 総回転数（リセット累積込み）
  ballsUsed,     // 総使用玉数（リセット累積込み）
  memo,          // メモ（任意・200文字以内）
}
```

> **回転率（rotationRate）は保存しない。** 表示時に毎回計算する（後述）。

---

## コード規約

### 色は `THEMES` 定数で一元管理（ライト／ダークの2セット）
色のハードコード（`'#0066FF'` など）は禁止。`THEMES.light` / `THEMES.dark` に同じ名前で定義し、
画面では `colors.primary` のようにテーマ経由で参照する。
スタイルは `makeStyles(colors)` が作り、`App()` 内で `styles` として使う。
再利用コンポーネント（`ScreenHeader` など）は `useContext(ThemeContext)` から `styles` を受け取る。
表示モードは設定（`settings.theme`: `auto` / `light` / `dark`）で切り替え、`auto` は端末に従う。
配色は Apple 系のミニマルデザイン（白基調 + 青。ダークは濃紺寄りのグレー3段）。
面の高さは枠線ではなく影（`surfaceShadow`）で出す。ダークでは影を付けず面の明るさの差で表す。

### 画面名は `SCREEN` 定数を使う
`setScreen('home')` ではなく `setScreen(SCREEN.HOME)`。タイプミスを防ぐため。

### 再利用コンポーネント（`App()` の直後に定義）
- `AppButton({ label, onPress, variant })` — `variant="secondary"` で見た目を切替
- `DetailRow({ label, value, highlight })` — 詳細画面の「ラベル＋値」行
- `renderSuggestions(...)` — 機種名・店舗名の入力候補リスト（共通）

### 日本語で書く
- UI テキスト・コメントはすべて**日本語**
- 用語は統一：「遊技開始」「総回転数」「総使用玉数」

---

## 重要な実装上の注意点

### 1. 回転率は「表示時に動的計算」する
保存された `rotations` と `ballsUsed` から、**現在の** `settings.rateBalls` で都度計算する：
```js
rate = (rotations / ballsUsed) * settings.rateBalls
```
これにより、設定で基準玉数を変えると過去の全記録の表示も追従する。

### 2. リセット（大当たり）の累積処理
遊技中に台の回転数がリセットされたら「リセットして続ける」を使う。
`accumulatedRotations` / `accumulatedBalls` にそれまでのセグメントを加算し、新しい開始回転数で継続する。総回転数・総玉数は常に累積込みで計算する。

### 3. `||` ではなく `isNaN()` で判定する
`parseInt("0", 10)` は `0`（falsy）。`parseInt(x) || fallback` は値が 0 のとき誤って fallback を返す。
数値の有無判定には必ず `isNaN()` を使う。

### 4. 入力検証
- 文字数上限：機種名・店舗名 50 / 台番号 5 / 数値入力 7桁 / メモ 200
- 回転数 0 回での保存はブロック
- 編集画面では存在しない日付（2/31 等）を弾く。「終了 < 開始」の時刻は翌日の終了とみなす（所要時間も 24 時間を足して計算）
- 記録を書き込む前は必ず `getSessionsForWrite()` で土台の一覧を取る（読み込み失敗のまま空で上書きしないため）

---

## 開発者について

- **JavaScript の基礎はあるが、React / Expo は初心者**
- コマンドライン操作は最低限にしたい
- 実装は**ステップバイステップ**で、日本語で説明する
- エラーが出たら原因と対処を分かりやすく解説する
- 大きな変更の前には方針・プランを提示し、合意してから着手する

