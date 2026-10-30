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
