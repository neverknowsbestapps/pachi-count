// 記録の書き出し・取り込みをファイルで行う（設定 → データ管理）
//
// 以前は記録の全文を共有シートへ文字として渡していたが、件数が増えると
// Android の共有の上限（およそ 1MB）に当たって失敗する。ファイルにして渡せば上限に当たらない。
// ブラウザでは隣の backup.web.js が使われる（ダウンロードと、ブラウザのファイル選択）。

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// 文字をファイルに書いて、共有シートで渡す（保存先・送り先は利用者が選ぶ）
export async function shareTextFile(name, text) {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: name,
  });
}

// ファイルを1つ選んでもらい、中身の文字を返す（選ばずに閉じたら null）
export async function pickTextFile() {
  const picked = await File.pickFileAsync();
  if (!picked || picked.canceled || !picked.result) return null;
  return await picked.result.text();
}
