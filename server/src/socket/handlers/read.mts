import type { Socket } from 'socket.io';
import { logger } from '../../utils/logger.mts';
import { pool } from '../../db/pool.mts';
import { isRoomMember } from '../../services/roomMembership.mts';
import { isUuid } from '../../utils/uuid.mts';
import { announceUnreadChanged } from '../../services/unreadChanged.mts';

interface ReadPayload {
  room_id?: string;
  message_ids?: string[];
}

/**
 * Handle message:read event (cursor-based)
 */
export function registerReadHandler(socket: Socket): void {
  socket.on('message:read', async (data: ReadPayload) => {
    // ★ 値の形を入口で確かめる (2026-10-01、null が例外になっていた)
    if (!data || typeof data !== 'object') return;
    const { room_id, message_ids } = data;
    logger.debug(`message:read user=${socket.user.id} room=${room_id} count=${message_ids?.length || 0}`);
    if (!room_id || !Array.isArray(message_ids) || message_ids.length === 0) return;

    try {
      // ★ メンバーでなければ既読位置を書かない (以前は部屋の ID だけで書け、既読数が増えた)
      if (!(await isRoomMember(room_id, socket.user.id))) return;

      // Find the latest message among the ones being read
      // ★ この部屋のメッセージだけ (別の部屋の ID で既読位置を進めない)
      const latestMsg = await pool.query<{ id: string; created_at: Date }>(
        `SELECT id, created_at FROM messages
         WHERE id = ANY($1::uuid[]) AND room_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [message_ids.filter(isUuid), room_id]
      );

      if (latestMsg.rows.length > 0) {
        // Advance cursor
        await pool.query(
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
          [room_id, socket.user.id, latestMsg.rows[0].id, latestMsg.rows[0].created_at]
        );
      }

      // Calculate read counts for the affected messages using cursor
      const readCounts = await pool.query<{ message_id: string; read_count: number }>(
        `SELECT m.id AS message_id,
                (SELECT COUNT(*)::int FROM room_read_cursors rrc
                 WHERE rrc.room_id = $2 AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
                ) AS read_count
         FROM messages m
         WHERE m.id = ANY($1::uuid[]) AND m.room_id = $2`,
        // ★ #483 部屋に流す既読数も、この部屋のメッセージだけ (以前は別の部屋の ID も数えて流していた)
        [message_ids.filter(isUuid), room_id]
      );
      const counts: Record<string, number> = {};
      readCounts.rows.forEach(r => { counts[r.message_id] = r.read_count; });

      socket.to(room_id).emit('message:read', {
        room_id,
        read_counts: counts,
      });
      announceUnreadChanged(socket.user.id, room_id);   // ★ #532 自分の別の端末の一覧へ
    } catch (err) {
      logger.error('Socket message:read error:', err);
    }
  });
}
