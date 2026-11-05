/**
 * 写真・ファイルを端末に保存する (2026-11-05 小野さん、iPhone の Safari)。
 *
 * ★ 以前は <a download> を押すだけで、iPhone の Safari は画像ファイルそのものの画面 (「"プレビュー" で開く」) へ移り、
 *   Tealus に戻る道が無かった。共有シートでファイルを渡せる端末 (iPhone・Android) では、取ってきてから共有シートを開く
 *   (「画像を保存」が出る。画面は移らない)。渡せない端末 (PC) は今までどおりダウンロード (新しいタブで)
 * ★ 共有をやめた (AbortError) ときは何もしない (ダウンロードに切り替えると、また画面が移る)
 */
export interface SaveTarget { path: string; name: string }

async function shareFiles(targets: SaveTarget[]): Promise<'done' | 'fallback'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'fallback';
  try {
    const files: File[] = [];
    for (const t of targets) {
      const res = await fetch(`/media/${t.path}`);
      if (!res.ok) return 'fallback';
      const blob = await res.blob();
      files.push(new File([blob], t.name, { type: blob.type || 'application/octet-stream' }));
    }
    if (!nav.canShare({ files })) return 'fallback';
    try {
      await nav.share({ files });
      return 'done';
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return 'done';   // やめた
      // ★ 取ってくる間に「押した直後」の扱いが切れると iPhone は共有を断る (NotAllowedError)。ダウンロードへ
      return 'fallback';
    }
  } catch {
    return 'fallback';   // 取れなければダウンロードへ
  }
}

function download(t: SaveTarget): void {
  const a = document.createElement('a');
  a.href = `/media/${t.path}`;
  a.download = t.name;
  // ★ 新しいタブで開く。iPhone の Safari は download を見ずに画像の画面へ移るので、同じタブだと Tealus に戻れなかった
  a.target = '_blank';
  a.rel = 'noopener';
  a.click();
}

export async function saveMediaFile(filePath: string, fileName: string): Promise<void> {
  await saveMediaFiles([{ path: filePath, name: fileName }]);
}

/** まとめて保存。共有シートが使えれば 1 回で全部渡す。使えなければ 300ms おきに 1 枚ずつダウンロード */
export async function saveMediaFiles(targets: SaveTarget[]): Promise<void> {
  if (targets.length === 0) return;
  if (await shareFiles(targets) === 'done') return;
  targets.forEach((t, i) => { if (i === 0) download(t); else setTimeout(() => download(t), i * 300); });
}
