import type { Server } from 'socket.io';
import { pool } from '../db/pool.mts';

/**
 * ルームに system メッセージを 1 件入れて配信する。
 *
 * 元は `routes/members.mts` の private helper だった (#390 で共有化)。
 * bot の join だけが「入ったことがルームに出ない」経路になっていたので、
 * 人間側の招待と同じ見え方に揃えるために切り出した。**文面と挙動は元のまま。**
 *
 * sender_id はルームの誰か 1 人を借りる (元実装のまま)。system 種別なので
 * 表示名は配信時に「システム」で上書きされる。
 */
export async function insertSystemMessage(
  roomId: string,
  content: string,
  io: Server | undefined
): Promise<void> {
  const result = await pool.query(
    `INSERT INTO messages (room_id, sender_id, content, type)
     VALUES ($1, (SELECT user_id FROM room_members WHERE room_id = $1 LIMIT 1), $2, 'system')
     RETURNING *`,
    [roomId, content]
  );

  if (io) {
    io.to(roomId).emit('message:new', {
      ...result.rows[0],
      sender_display_name: 'システム',
    });
  }
}
