/**
 * #601 削除した投稿の添付ファイルは開けなくする (ファイルは残す)。/media の配信 (utils/mediaStatic.mts) が使う。
 *
 * ★ 隠すのは、そのファイルを使っている投稿が **全部** 削除されているときだけ。
 *   転送は同じファイルを共有するので、「削除された投稿に付いている」だけで隠すと、転送先の生きている投稿の
 *   添付まで開けなくなる (2026-10-14 の本番: 削除された投稿の添付 40 件のうち 2 本が該当)
 * ★ message_media に載っていないファイル (アイコン・スタンプ等) は隠さない
 * ★ #602 部屋を削除すると行ごと消えるので、消す前に removed_media へ記録する (rememberRoomMedia)。
 *   記録にあり、生きている投稿が使っていなければ隠す
 */
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';

interface Queryable {
  query<R extends object>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** relPath は /media からの相対パス (例: images/xxx.png)。message_media の file_path / thumbnail_path と同じ形 */
let warnedNoRemovedMedia = false;

export async function isMediaHidden(relPath: string, db: Queryable = pool): Promise<boolean> {
  let r: { used: number; live: boolean | null; removed: boolean };
  try {
    ({ rows: [r] } = await db.query<{ used: number; live: boolean | null; removed: boolean }>(
      `SELECT count(*)::int AS used, bool_or(NOT m.is_deleted) AS live,
              EXISTS (SELECT 1 FROM removed_media WHERE file_path = $1) AS removed
         FROM message_media mm JOIN messages m ON m.id = mm.message_id
        WHERE mm.file_path = $1 OR mm.thumbnail_path = $1`,
      [relPath],
    ));
  } catch (err) {
    // ★ v0.11.0 のリリース前チェック (10-15): migrate を忘れて再起動すると removed_media (040) が無く、
    //   ここで毎回失敗して /media の添付が全部 500 になった。表が無いときだけ #601 の判定に退く (隠す働きはその分残る)
    if ((err as { code?: unknown } | null)?.code !== '42P01') throw err;
    if (!warnedNoRemovedMedia) {
      warnedNoRemovedMedia = true;
      logger.warn('[media] removed_media の表がありません。`npm run migrate` を流してください (削除した部屋の添付がまだ開けます)');
    }
    ({ rows: [r] } = await db.query<{ used: number; live: boolean | null; removed: boolean }>(
      `SELECT count(*)::int AS used, bool_or(NOT m.is_deleted) AS live, false AS removed
         FROM message_media mm JOIN messages m ON m.id = mm.message_id
        WHERE mm.file_path = $1 OR mm.thumbnail_path = $1`,
      [relPath],
    ));
  }
  if (r.live) return false;   // 生きている投稿が使っている (転送の写しなど)
  return r.used > 0 || r.removed === true;
}

/**
 * #602 部屋を消す前に、その部屋の投稿の添付を removed_media へ記録する。部屋の削除と同じ処理 (トランザクション) の中で呼ぶ
 */
export async function rememberRoomMedia(roomId: string, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO removed_media (file_path)
     SELECT p FROM (
       SELECT mm.file_path AS p FROM message_media mm JOIN messages m ON m.id = mm.message_id WHERE m.room_id = $1
       UNION
       SELECT mm.thumbnail_path FROM message_media mm JOIN messages m ON m.id = mm.message_id WHERE m.room_id = $1 AND mm.thumbnail_path IS NOT NULL
     ) x
     ON CONFLICT (file_path) DO NOTHING`,
    [roomId],
  );
}
