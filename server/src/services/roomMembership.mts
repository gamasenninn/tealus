import { pool } from '../db/pool.mts';
import { isUuid } from '../utils/uuid.mts';

/**
 * 操作を受ける前に、その部屋のメンバーかを確かめる (2026-09-30)。socket と REST の両方で使う。
 * ★ 部屋の ID だけで動く操作 (通話・既読・ボット API など) の入口で使う。形の崩れた ID は DB に聞かずに false
 */
export async function isRoomMember(roomId: unknown, userId: string): Promise<boolean> {
  if (!isUuid(roomId)) return false;
  const r = await pool.query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
  return r.rows.length > 0;
}
