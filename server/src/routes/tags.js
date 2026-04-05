const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');

// ============================================
// Room-scoped tag routes: /api/rooms/:id/tags
// ============================================
const roomRouter = express.Router({ mergeParams: true });
roomRouter.use(authenticate);
roomRouter.use(requireMember);

/**
 * POST /api/rooms/:id/tags
 * Create a tag in a room (or return existing)
 */
roomRouter.post('/', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'タグ名は必須です' });
  }

  const trimmed = name.trim();

  try {
    // Check if tag already exists
    const existing = await pool.query(
      'SELECT * FROM tags WHERE room_id = $1 AND name = $2',
      [roomId, trimmed]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({ tag: existing.rows[0] });
    }

    const result = await pool.query(
      `INSERT INTO tags (room_id, name, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [roomId, trimmed, userId]
    );

    logger.info(`Tag created: "${trimmed}" in room ${roomId}`);
    res.status(201).json({ tag: result.rows[0] });
  } catch (err) {
    logger.error('Tag create error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/tags
 * List tags in a room with usage count
 */
roomRouter.get('/', async (req, res) => {
  const roomId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT t.*, COUNT(mt.message_id)::int AS usage_count
       FROM tags t
       LEFT JOIN message_tags mt ON mt.tag_id = t.id
       WHERE t.room_id = $1
       GROUP BY t.id
       ORDER BY usage_count DESC, t.created_at DESC`,
      [roomId]
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('Tag list error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/tags/suggest?q=prefix
 * Suggest tags by prefix match
 */
roomRouter.get('/suggest', async (req, res) => {
  const roomId = req.params.id;
  const { q } = req.query;

  if (!q) {
    return res.json({ tags: [] });
  }

  try {
    const result = await pool.query(
      `SELECT t.*, COUNT(mt.message_id)::int AS usage_count
       FROM tags t
       LEFT JOIN message_tags mt ON mt.tag_id = t.id
       WHERE t.room_id = $1 AND t.name LIKE $2
       GROUP BY t.id
       ORDER BY usage_count DESC
       LIMIT 10`,
      [roomId, q + '%']
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('Tag suggest error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// ============================================
// Message-scoped tag routes: /api/messages/:id/tags
// ============================================
const messageRouter = express.Router({ mergeParams: true });
messageRouter.use(authenticate);

/**
 * Middleware: check message exists and user is room member
 */
async function requireMessageAccess(req, res, next) {
  const messageId = req.params.id;
  const userId = req.user.id;

  try {
    const msg = await pool.query(
      'SELECT m.room_id FROM messages m WHERE m.id = $1',
      [messageId]
    );
    if (msg.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const roomId = msg.rows[0].room_id;
    const member = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: E.ROOM_ACCESS_DENIED });
    }

    req.messageRoomId = roomId;
    next();
  } catch (err) {
    logger.error('Message access check error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
}

messageRouter.use(requireMessageAccess);

/**
 * POST /api/messages/:id/tags
 * Add a tag to a message (by tag_id or by name)
 */
messageRouter.post('/', async (req, res) => {
  const messageId = req.params.id;
  const roomId = req.messageRoomId;
  const userId = req.user.id;
  const { tag_id, name } = req.body;

  try {
    let tagId = tag_id;

    // If name provided, find or create tag
    if (!tagId && name) {
      const trimmed = name.trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'タグ名は必須です' });
      }

      const existing = await pool.query(
        'SELECT id FROM tags WHERE room_id = $1 AND name = $2',
        [roomId, trimmed]
      );

      if (existing.rows.length > 0) {
        tagId = existing.rows[0].id;
      } else {
        const created = await pool.query(
          `INSERT INTO tags (room_id, name, created_by)
           VALUES ($1, $2, $3) RETURNING *`,
          [roomId, trimmed, userId]
        );
        tagId = created.rows[0].id;
      }
    }

    if (!tagId) {
      return res.status(400).json({ error: 'tag_id または name は必須です' });
    }

    // Check if already tagged
    const existing = await pool.query(
      'SELECT 1 FROM message_tags WHERE message_id = $1 AND tag_id = $2',
      [messageId, tagId]
    );

    if (existing.rows.length > 0) {
      const tag = await pool.query('SELECT * FROM tags WHERE id = $1', [tagId]);
      return res.status(200).json({ tag: tag.rows[0] });
    }

    // Add tag to message
    await pool.query(
      `INSERT INTO message_tags (message_id, tag_id, created_by)
       VALUES ($1, $2, $3)`,
      [messageId, tagId, userId]
    );

    // Return the tag
    const tag = await pool.query('SELECT * FROM tags WHERE id = $1', [tagId]);

    res.status(201).json({ tag: tag.rows[0] });
  } catch (err) {
    logger.error('Message tag add error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/messages/:id/tags
 * Get tags on a message
 */
messageRouter.get('/', async (req, res) => {
  const messageId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT t.* FROM tags t
       JOIN message_tags mt ON mt.tag_id = t.id
       WHERE mt.message_id = $1
       ORDER BY t.name`,
      [messageId]
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('Message tags get error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/messages/:id/tags/:tagId
 * Remove a tag from a message
 */
messageRouter.delete('/:tagId', async (req, res) => {
  const messageId = req.params.id;
  const tagId = req.params.tagId;

  try {
    await pool.query(
      'DELETE FROM message_tags WHERE message_id = $1 AND tag_id = $2',
      [messageId, tagId]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Message tag remove error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = { roomRouter, messageRouter };
