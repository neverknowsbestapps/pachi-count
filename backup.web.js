// ブラウザでの記録の書き出し・取り込み（backup.js の説明も参照）。
// ファイルの部品はネイティブ専用なので、ブラウザ標準のダウンロードとファイル選択を使う。

// 文字をファイルにしてダウンロードさせる
export async function shareTextFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ファイルを1つ選んでもらい、中身の文字を返す（選ばずに閉じたら null）
export function pickTextFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,application/json,text/plain';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      file.text().then(resolve, reject);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
