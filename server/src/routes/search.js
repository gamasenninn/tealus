const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/search?q=keyword&room_id=optional&limit=50
 * Search messages across all rooms (or within a specific room)
 * Searches both message content and voice transcriptions
 */
router.get('/', async (req, res) => {
  const { q, room_id, limit = 50, offset = 0 } = req.query;
  const userId = req.user.id;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: '検索キーワードは必須です' });
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
  const parsedOffset = Math.max(parseInt(offset) || 0, 0);
  const keyword = `%${q.trim()}%`;

  try {
    let query;
    let params;

    if (room_id) {
      // Room-specific search
      query = `
        SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at, m.is_deleted,
               u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               r.name AS room_name, r.type AS room_type,
               vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
        LEFT JOIN LATERAL (
          SELECT formatted_text, raw_text FROM voice_transcriptions
          WHERE message_id = m.id ORDER BY version DESC LIMIT 1
        ) vt ON m.type = 'voice'
        WHERE m.room_id = $2
          AND m.is_deleted = false
          AND (
            m.content ILIKE $3
            OR (m.type = 'voice' AND (vt.formatted_text ILIKE $3 OR vt.raw_text ILIKE $3))
          )
        ORDER BY m.created_at DESC
        LIMIT $4 OFFSET $5
      `;
      params = [userId, room_id, keyword, parsedLimit, parsedOffset];
    } else {
      // Cross-room search
      query = `
        SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at, m.is_deleted,
               u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               r.name AS room_name, r.type AS room_type,
               vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
        LEFT JOIN LATERAL (
          SELECT formatted_text, raw_text FROM voice_transcriptions
          WHERE message_id = m.id ORDER BY version DESC LIMIT 1
        ) vt ON m.type = 'voice'
        WHERE m.is_deleted = false
          AND (
            m.content ILIKE $2
            OR (m.type = 'voice' AND (vt.formatted_text ILIKE $2 OR vt.raw_text ILIKE $2))
          )
        ORDER BY m.created_at DESC
        LIMIT $3 OFFSET $4
      `;
      params = [userId, keyword, parsedLimit, parsedOffset];
    }

    const result = await pool.query(query, params);

    // For voice messages, use transcription as display content
    const results = result.rows.map(r => {
      if (r.type === 'voice' && !r.content) {
        r.content = r.transcription_text || r.transcription_raw || null;
      }
      // Get room display name for direct rooms
      if (r.room_type === 'direct') {
        r.room_name = r.sender_display_name;
      }
      return r;
    });

    res.json({ results });
  } catch (err) {
    logger.error('Search error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
