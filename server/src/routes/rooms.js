const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember, requireRoomAdmin, requireGroup } = require('../middleware/roomAccess');

const ICON_DIR = path.join(__dirname, '../../../media/icons');
const iconStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ICON_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  },
});
const iconUpload = multer({ storage: iconStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/rooms
 * Create a group room
 */
router.post('/', async (req, res) => {
  const { name, member_ids } = req.body;
  const userId = req.user.id;

  if (!name) {
    return res.status(400).json({ error: 'グループ名は必須です' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create room
    const roomResult = await client.query(
      `INSERT INTO rooms (type, name, created_by)
       VALUES ('group', $1, $2)
       RETURNING *`,
      [name, userId]
    );
    const room = roomResult.rows[0];

    // Add creator as admin
    await client.query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [room.id, userId]
    );

    // Add other members
    const allMemberIds = Array.isArray(member_ids) ? member_ids : [];
    for (const memberId of allMemberIds) {
      if (memberId !== userId) {
        await client.query(
          `INSERT INTO room_members (room_id, user_id, role)
           VALUES ($1, $2, 'member')`,
          [room.id, memberId]
        );
      }
    }

    await client.query('COMMIT');

    // Fetch members
    const membersResult = await pool.query(
      `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1`,
      [room.id]
    );

    res.status(201).json({ room, members: membersResult.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Create room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

/**
 * POST /api/rooms/direct
 * Create or get a direct (1-on-1) room
 */
router.post('/direct', async (req, res) => {
  const { partner_id } = req.body;
  const userId = req.user.id;

  if (!partner_id) {
    return res.status(400).json({ error: '相手のユーザーIDは必須です' });
  }

  try {
    // Check if direct room already exists between these two users
    const existingResult = await pool.query(
      `SELECT r.* FROM rooms r
       WHERE r.type = 'direct'
         AND r.id IN (
           SELECT room_id FROM room_members WHERE user_id = $1
         )
         AND r.id IN (
           SELECT room_id FROM room_members WHERE user_id = $2
         )`,
      [userId, partner_id]
    );

    if (existingResult.rows.length > 0) {
      const room = existingResult.rows[0];
      const membersResult = await pool.query(
        `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = $1`,
        [room.id]
      );
      return res.status(200).json({ room, members: membersResult.rows });
    }

    // Create new direct room
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const roomResult = await client.query(
        `INSERT INTO rooms (type, created_by)
         VALUES ('direct', $1)
         RETURNING *`,
        [userId]
      );
      const room = roomResult.rows[0];

      await client.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
        [room.id, userId, partner_id]
      );

      await client.query('COMMIT');

      const membersResult = await pool.query(
        `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = $1`,
        [room.id]
      );

      res.status(201).json({ room, members: membersResult.rows });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Create direct room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms
 * List rooms the current user belongs to
 */
router.get('/', async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT r.*,
              m.content AS last_message_content,
              m.created_at AS last_message_at,
              m.type AS last_message_type,
              u.display_name AS last_message_sender,
              partner.user_id AS partner_id,
              partner.display_name AS partner_display_name,
              partner.avatar_url AS partner_avatar_url,
              COALESCE(unread.count, 0)::int AS unread_count,
              (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS member_count
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       LEFT JOIN LATERAL (
         SELECT content, created_at, type, sender_id
         FROM messages
         WHERE room_id = r.id AND is_deleted = false
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN LATERAL (
         SELECT rm2.user_id, u2.display_name, u2.avatar_url
         FROM room_members rm2
         JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != $1
         LIMIT 1
       ) partner ON r.type = 'direct'
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS count
         FROM messages msg
         WHERE msg.room_id = r.id
           AND msg.is_deleted = false
           AND msg.sender_id != $1
           AND msg.created_at > COALESCE(
             (SELECT last_read_at FROM room_read_cursors WHERE room_id = r.id AND user_id = $1),
             '1970-01-01'
           )
       ) unread ON true
       WHERE rm.user_id = $1
       ORDER BY COALESCE(m.created_at, r.created_at) DESC`,
      [userId]
    );

    res.json({ rooms: result.rows });
  } catch (err) {
    logger.error('List rooms error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id
 * Get room details with members
 */
router.get('/:id', requireMember, async (req, res) => {
  const { id } = req.params;

  try {
    // Get room
    const roomResult = await pool.query('SELECT * FROM rooms WHERE id = $1', [id]);
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }

    // Get members
    const membersResult = await pool.query(
      `SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1`,
      [id]
    );

    // Get last read message ID for unread separator
    const cursorResult = await pool.query(
      'SELECT last_read_message_id FROM room_read_cursors WHERE room_id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    const last_read_message_id = cursorResult.rows[0]?.last_read_message_id || null;

    res.json({ room: roomResult.rows[0], members: membersResult.rows, last_read_message_id });
  } catch (err) {
    logger.error('Get room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/rooms/:id
 * Update group name (group admin only)
 */
router.put('/:id', requireGroup, requireMember, requireRoomAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, allow_member_transcription_edit } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(name); }
    if (allow_member_transcription_edit !== undefined) { updates.push(`allow_member_transcription_edit = $${paramIndex++}`); values.push(allow_member_transcription_edit); }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    updates.push('updated_at = now()');
    values.push(id);

    const result = await pool.query(
      `UPDATE rooms SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    res.json({ room: result.rows[0] });
  } catch (err) {
    logger.error('Update room error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms/:id/icon
 * Upload group icon (group admin only)
 */
router.post('/:id/icon', requireGroup, requireMember, requireRoomAdmin, iconUpload.single('icon'), async (req, res) => {
  const { id } = req.params;

  try {
    if (!req.file) return res.status(400).json({ error: '画像ファイルが添付されていません' });

    const iconUrl = `icons/${req.file.filename}`;
    const result = await pool.query(
      'UPDATE rooms SET icon_url = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [iconUrl, id]
    );
    res.json({ room: result.rows[0] });
  } catch (err) {
    logger.error('Upload room icon error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
