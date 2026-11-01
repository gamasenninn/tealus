/**
 * doctor: DB が指しているのにファイルが無い添付 (改善ループ 34)
 *
 * ★ 添付はファイル (メディアの置き場) と DB の行の 2 か所にあり、黙って食い違う。
 *   無ければ開いたときに壊れた画像・404 になるが、利用者が開くまで誰も気づかない。
 * ★★ 逆向き (ファイルはあるが DB から辿れない) は数えない。「メディアは消さない」方針 (10-10) で、
 *   容量を食うだけで壊れはしないため
 * ★ 読むだけ。ファイルの中身は開かない (在るかどうかだけ)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from './doctor.mts';

export interface MediaRefs {
  checked: number;
  missing: string[];
}

const EXAMPLES = 3;

export function judgeMediaRefs(refs: MediaRefs | null): Finding {
  if (refs === null) {
    return {
      id: 'media-refs',
      level: 'info',
      detail: '添付のファイルが在るかは確かめられませんでした (DB に届かない)',
      fix: 'DB に届くようになってから、もう一度 npm run doctor を叩いてください',
    };
  }
  if (refs.missing.length === 0) {
    return {
      id: 'media-refs',
      level: 'info',
      detail: `DB が指す添付 ${refs.checked} 本: 欠け 0`,
      fix: '対応は要りません',
    };
  }
  return {
    id: 'media-refs',
    level: 'warn',
    detail: `DB が指す添付 ${refs.checked} 本: 欠け ${refs.missing.length} (例 ${refs.missing.slice(0, EXAMPLES).join(', ')})`,
    fix: 'NAS のバックアップ (メディアの写し) に同じ名前があれば戻せます。無ければその投稿の添付は開けません',
  };
}

/** 置き場 (mediaDir) に無いパスだけを返す。パスは置き場からの相対 (DB の file_path / thumbnail_path と同じ形) */
export function findMissingMedia(mediaDir: string, relPaths: string[]): MediaRefs {
  const missing = relPaths.filter((p) => !fs.existsSync(path.join(mediaDir, p)));
  return { checked: relPaths.length, missing };
}
