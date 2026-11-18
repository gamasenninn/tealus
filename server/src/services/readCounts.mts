import { pool } from '../db/pool.mts';
import { isUuid } from '../utils/uuid.mts';

/**
 * 既読を付けた投稿の「既読 N」を数える (部屋に流す message:read の read_counts)。
 * ★ socket の message:read と REST の既読 (ホームで読んだお知らせ) が同じ数え方で配るよう、ここに 1 つだけ置く
 *   (以前は socket の道にしか無く、ホームで読まれても投稿者の開いている画面の「既読 N」が動かなかった、改善ループ 26 回目)
 */
export async function countReads(roomId: string, messageIds: unknown[]): Promise<Record<string, number>> {
  const readCounts = await pool.query<{ message_id: string; read_count: number }>(
    `SELECT m.id AS message_id,
            (SELECT COUNT(*)::int FROM room_read_cursors rrc
             WHERE rrc.room_id = $2 AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
            ) AS read_count
     FROM messages m
     WHERE m.id = ANY($1::uuid[]) AND m.room_id = $2`,
    // ★ #483 部屋に流す既読数も、この部屋のメッセージだけ (以前は別の部屋の ID も数えて流していた)
    [messageIds.filter(isUuid), roomId]
  );
  const counts: Record<string, number> = {};
  readCounts.rows.forEach(r => { counts[r.message_id] = r.read_count; });
  return counts;
}

/** pool でもトランザクションの client でも渡せる */
interface Queryable { query: (sql: string, params?: unknown[]) => Promise<unknown> }

/**
 * 既読の位置を進める (改善ループ 69、#649 B-3)。画面の既読・すべて既読・Bot の既読・socket の既読の 4 か所で使う。
 * ★ 新しいほうを残す (別の端末がより先まで読んでいたら戻さない)。以前は同じ 10 行を 4 か所に写していて、
 *   #553 で「すべて既読」の 1 か所だけこの守り (GREATEST) が無く、未読が戻りえた
 * ★ 位置は便の時刻 + 1 ミリ秒 (同じ時刻の便を未読に数えないため。前からの約束)
 */
export async function advanceReadCursor(db: Queryable, roomId: string, userId: string, messageId: string, createdAt: string | Date): Promise<void> {
  await db.query(
    `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
     VALUES ($1, $2, $3, $4::timestamptz + interval '1 millisecond')
     ON CONFLICT (room_id, user_id)
     DO UPDATE SET
       last_read_message_id = CASE
         WHEN room_read_cursors.last_read_at < EXCLUDED.last_read_at
         THEN EXCLUDED.last_read_message_id
         ELSE room_read_cursors.last_read_message_id
       END,
       last_read_at = GREATEST(room_read_cursors.last_read_at, EXCLUDED.last_read_at)`,
    [roomId, userId, messageId, createdAt],
  );
}
