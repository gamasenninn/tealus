import path from 'node:path';

/**
 * #561 保存するファイル名に付ける拡張子。英数字だけ (1〜10 字) なら小文字で返し、外れたら fallback。
 * ★ 以前は元のファイル名の拡張子 (path.extname) をそのまま保存名に付けていた。path.extname は最後のドット以降を
 *   丸ごと返すので、記号や空白を含む拡張子もそのまま物理ファイル名に入った (アップロード・音声・LINE の 3 か所)
 */
export function safeExt(name: string | null | undefined, fallback = ''): string {
  if (!name) return fallback;
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : fallback;
}
