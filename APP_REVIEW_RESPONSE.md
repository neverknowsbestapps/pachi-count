# App Review「Guideline 2.1」対応

対象: パチカウント 1.1.0 for iOS  
状況: アプリの不具合による却下ではなく、審査継続に必要な情報の追加依頼  
実機: iPhone 12 / iOS 26.6

## やる順番

### 1. 実機情報を確認する

iPhoneの「設定」→「一般」→「情報」で、次の2つを控える。

- 機種名: `iPhone 12`
- 審査用録画で使用するiOSバージョン: `26.6`

「設定」→「一般」→「ソフトウェアアップデート」も開き、更新がある場合は先に更新する。

### 2. 実機で画面収録する

個人情報や実在する店舗名は使わず、以下の順番で2〜3分程度にまとめる。

1. パチカウントを完全に閉じた状態にする
2. iPhoneの画面収録を開始する
3. ホーム画面から「パチカウント」を起動する
4. 「遊技開始」を開く
5. 開始時の回転数に `100` を入力する
6. 任意項目には、機種名 `審査用テスト`、店舗名 `テスト店舗`、台番号 `1` を入力する
7. 「遊技開始」を押す
8. 現在の回転数を `120`、使用玉数を `250` にして、回転率が自動計算される様子を映す
9. 「回転数リセット」を開き、リセット後の回転数を `0` にして遊技を続けられることを映す
10. 現在の回転数を `15`、使用玉数を `250` にする
11. 「遊技終了・保存」を押す
12. ホームの記録一覧から保存した記録を開く
13. 詳細画面、編集画面、共有画面を順に映す。共有先は選ばず閉じる
14. 設定画面を開き、基準玉数と入力ボタンを変更できることを映す。変更は保存しなくてよい
15. 画面収録を終了する

収録中に広告が表示されても問題ない。広告をタップしない。

### 3. App Store Connectで返信する

App Store Connectの「App Review」ページを開き、画面収録を添付して、下の英文を返信欄に貼り付ける。

端末情報は `iPhone 12 / iOS 26.6` を反映済み。

## 返信用英文

```text
Hello App Review Team,

Thank you for your review. Please find the requested information below. We have also attached a screen recording captured on a physical iPhone running the latest available iOS version. The recording begins with launching the app and demonstrates its typical user flow and core features.

1. Screen recording

The attached recording shows:
- Launching the app
- Starting a new play record
- Entering the machine's displayed rotation count and the number of balls used
- Automatic calculation of rotations per configured number of balls
- Continuing a record after the machine's displayed rotation count resets
- Saving and viewing a record
- Editing and sharing a saved record
- Changing the calculation basis and input button values in Settings

The app does not include account registration or login, purchases or subscriptions, user-generated content, or prompts requesting access to sensitive device data or capabilities.

2. Tested devices and operating systems

- iPhone 12 running iOS 26.6

3. App functions and target audience

PachiCount is an on-device record and calculation utility for adults aged 18 or older who play pachinko in Japan. Users manually enter the rotation count displayed by a pachinko machine and the number of balls they have used. The app automatically calculates the number of rotations per a configurable number of balls and stores the user's play records on the device.

The app replaces handwritten notes and manual calculations. It does not provide gambling, betting, lottery, prize, payment, money-transfer, prediction, or game functionality. It does not accept wagers or link users to gambling services.

4. Instructions for accessing the main features

No account, login credentials, sample files, or special setup are required.

To use the main feature:
1. Launch the app and tap "遊技開始".
2. Enter the rotation count currently displayed by the machine. Machine name, store name, machine number, and memo are optional.
3. Tap "遊技開始" again.
4. Enter or adjust the current rotation count and the number of balls used. The calculated rotation rate is updated automatically.
5. If the machine's displayed count resets, use "回転数リセット" and continue the same record.
6. Tap "遊技終了・保存" to save the record.
7. Tap a saved item on the home screen to view, edit, continue, share, or delete it.
8. The calculation basis and input button values can be changed from Settings.

5. External services, tools, and platforms

- Google AdMob is used only to display banner advertisements.
- Google User Messaging Platform, included with the advertising SDK, handles advertising consent where required by local law.
- The native iOS share sheet is used when the user explicitly chooses to share a saved record.

The app does not use a backend server, cloud storage, authentication service, payment processor, subscription service, AI service, or external data provider. All play records and settings are stored locally on the user's device. Core recording and calculation features work without an internet connection.

6. Regional differences

The app is currently distributed only in Japan. Its core functions and content do not vary by region. If distribution is expanded in the future, the advertising consent screen may vary according to local legal requirements, but the app's recording and calculation functions will remain the same.

7. Regulated industry and third-party material

The app is a manual record and calculation utility only. It does not conduct or facilitate gambling, accept money or wagers, award prizes, simulate pachinko gameplay, or provide access to gambling services. It does not include protected third-party machine data, logos, media, or other licensed content. Therefore, no regulatory license or third-party authorization is required for the functionality provided by the app.

We have also added this information to the App Review Information notes for future submissions.

Best regards,
Manamu Hattori
```

### 4. 今後の審査用メモを更新する

返信後、App Store Connectの「App Review Information」→「Notes」にも、上の英文を保存する。文字数制限で入らない場合は、少なくとも次の短縮版を保存する。

```text
PachiCount is an on-device record and calculation utility for adults aged 18 or older who play pachinko in Japan. No account or login is required.

Tap "遊技開始", enter the machine's displayed rotation count, then enter the current rotation count and number of balls used. The app calculates rotations per a configurable number of balls. Records can be saved, viewed, edited, continued, shared, or deleted. All records and settings are stored only on the user's device.

The app does not provide gambling, betting, lottery, prize, payment, money-transfer, prediction, or game functionality. It does not accept wagers or link to gambling services.

External services: Google AdMob for banner ads and Google User Messaging Platform for advertising consent where required. The app has no backend, cloud storage, login, payments, subscriptions, AI, or external data provider. Core features work offline.

The app is distributed only in Japan and has no regional differences in core functionality. No protected third-party machine data, logos, or licensed content is included.

Tested on: iPhone 12, iOS 26.6.
```

## 送信前チェック

- [ ] iPhone 12をiOS 26.6以降へ更新した
- [ ] 更新後のiOSバージョンを控えた
- [ ] 更新後の実機で画面収録を作成した
- [ ] 収録がアプリ起動から始まっている
- [ ] 個人情報や実在店舗の情報が映っていない
- [ ] 英文内のOSバージョンの空欄を実際の値へ置き換えた
- [ ] App Store Connectの返信に画面収録を添付した
- [ ] 英文を返信した
- [ ] App Review InformationのNotesも更新した
