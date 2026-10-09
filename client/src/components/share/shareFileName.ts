/**
 * #527 共有で受け取ったファイルの名前 (純関数)。
 *
 * ★ 2026-10-09 まで、受ける段 (public/custom-sw.js) が中身だけを一時置き場に置き、画面が
 *   `shared-番号.MIME の後半` で名前を作り直していた。本番で 236 件 (動画 138・写真 90) が
 *   元の名前 (撮った日時入り) を失い、Excel・Word では拡張子が長い文字列になった。
 * ★ 今は受ける段が元の名前を SHARE_NAME_HEADER に (encodeURIComponent で) 残す。
 *   無いとき (古い受ける段の端末) は番号の名前に倒す。新旧が混ざっても壊れない。
 */

/** ★ custom-sw.js と同じ名 (あちらは素の JS なので import できない。変えるときは両方) */
export const SHARE_NAME_HEADER = 'X-Share-File-Name';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/msword': 'doc',
  'application/zip': 'zip',
};

function fallbackName(index: number, mime: string): string {
  const sub = (mime.split('/')[1] || '').toLowerCase();
  // 知らない種類は、後半が短い英数字ならそれ、長い (vnd.… など) なら bin
  const ext = EXT_BY_MIME[mime.toLowerCase()] ?? (/^[a-z0-9]{1,5}$/.test(sub) ? sub : 'bin');
  return `shared-${index}.${ext}`;
}

/**
 * @param stored  受ける段がヘッダーに残した名前 (encodeURIComponent 済み)。無ければ null
 * @param index   何番目のファイルか (番号の名前に使う)
 * @param mime    ファイルの種類
 */
export function sharedFileName(stored: string | null, index: number, mime: string): string {
  if (stored) {
    try {
      // 区切り文字があれば最後だけ (場所の指定を持ち込まない)
      const name = decodeURIComponent(stored).split(/[\\/]/).pop()!.trim();
      if (name) return name;
    } catch {
      // 壊れたヘッダーは番号の名前に倒す
    }
  }
  return fallbackName(index, mime || '');
}
