import { logger } from '../../utils/logger.mts';
import * as E from '../../constants/errors.mts';
import express from 'express';
import { pool } from '../../db/pool.mts';

export const router = express.Router();

/** GET /rooms の一覧行 */
interface RoomRow {
  id: string;
  type: string;
  name: string | null;
  created_at: Date;
  member_count: number;
}

/** DM ルームのメンバー行 */
interface MemberRow {
  id: string;
  display_name: string;
}

/**
 * GET /api/admin/rooms
 * List all rooms (admin only) — エージェントのルーム名解決用
 */
router.get('/rooms', async (req, res) => {
  try {
    const result = await pool.query<RoomRow>(`
      SELECT r.id, r.type, r.name, r.created_at,
             (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS member_count
      FROM rooms r
      ORDER BY r.created_at
    `);

    // DM ルームのメンバー名を取得
    const rooms: Array<RoomRow & { members?: MemberRow[] }> = [];
    for (const r of result.rows) {
      const room: RoomRow & { members?: MemberRow[] } = { ...r };
      if (r.type === 'direct') {
        const members = await pool.query<MemberRow>(
          `SELECT u.id, u.display_name FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = $1`,
          [r.id]
        );
        room.members = members.rows;
      }
      rooms.push(room);
    }

    res.json({ rooms });
  } catch (err) {
    logger.error('Admin list rooms error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
