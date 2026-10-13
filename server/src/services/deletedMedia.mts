/**
 * #601 削除した投稿の添付ファイルは開けなくする (ファイルは残す)。/media の配信 (utils/mediaStatic.mts) が使う。
 *
 * ★ 隠すのは、そのファイルを使っている投稿が **全部** 削除されているときだけ。
 *   転送は同じファイルを共有するので、「削除された投稿に付いている」だけで隠すと、転送先の生きている投稿の
 *   添付まで開けなくなる (2026-10-14 の本番: 削除された投稿の添付 40 件のうち 2 本が該当)
 * ★ message_media に載っていないファイル (アイコン・スタンプ等) は隠さない
 */
import { pool } from '../db/pool.mts';

interface Queryable {
  query<R extends object>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** relPath は /media からの相対パス (例: images/xxx.png)。message_media の file_path / thumbnail_path と同じ形 */
export async function isMediaHidden(relPath: string, db: Queryable = pool): Promise<boolean> {
  const { rows: [r] } = await db.query<{ used: number; live: boolean | null }>(
    `SELECT count(*)::int AS used, bool_or(NOT m.is_deleted) AS live
       FROM message_media mm JOIN messages m ON m.id = mm.message_id
      WHERE mm.file_path = $1 OR mm.thumbnail_path = $1`,
    [relPath],
  );
  return r.used > 0 && !r.live;
}
