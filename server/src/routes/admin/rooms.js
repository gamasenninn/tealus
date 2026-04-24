const logger = require('../../utils/logger');
const E = require('../../constants/errors');
const express = require('express');
const pool = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/admin/rooms
 * List all rooms (admin only) — エージェントのルーム名解決用
 */
router.get('/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.type, r.name, r.created_at,
             (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS member_count
      FROM rooms r
      ORDER BY r.created_at
    `);

    // DM ルームのメンバー名を取得
    const rooms = [];
    for (const r of result.rows) {
      const room = { ...r };
      if (r.type === 'direct') {
        const members = await pool.query(
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

module.exports = router;
