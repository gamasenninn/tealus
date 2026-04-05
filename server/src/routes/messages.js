const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');
const { MESSAGES_DEFAULT_LIMIT, MESSAGES_MAX_LIMIT } = require('../constants/config');
const { attachMedia, attachReplies, attachTranscriptions, attachLinkPreviews, attachReactions, attachTags } = require('../services/messageAttachments');

const router = express.Router({ mergeParams: true });

router.use(authenticate, requireMember);

/**
 * POST /api/rooms/:id/messages
 * Send a message to a room
 */
router.post('/', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { content, type = 'text', reply_to } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'メッセージ内容は必須です' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [roomId, userId, content.trim(), type, reply_to || null]
    );

    const message = result.rows[0];
    res.status(201).json({ message });
  } catch (err) {
    logger.error('Send message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/messages
 * Get message history with cursor-based pagination
 */
router.get('/', async (req, res) => {
  const roomId = req.params.id;
  const { before, around, limit = MESSAGES_DEFAULT_LIMIT } = req.query;
  const parsedLimit = Math.min(Math.max(parseInt(limit) || MESSAGES_DEFAULT_LIMIT, 1), MESSAGES_MAX_LIMIT);

  try {
    let query;
    let params;

    if (around) {
      // Get messages around a specific message (for search jump)
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count FROM message_reads WHERE message_id = m.id
        ) rc ON true
        WHERE m.room_id = $1
          AND m.created_at >= (SELECT created_at FROM messages WHERE id = $2) - INTERVAL '1 second'
        ORDER BY m.created_at ASC
        LIMIT $3
      `;
      params = [roomId, around, parsedLimit];
    } else if (before) {
      // Get the created_at of the cursor message
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count FROM message_reads WHERE message_id = m.id
        ) rc ON true
        WHERE m.room_id = $1
          AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
        ORDER BY m.created_at DESC
        LIMIT $3
      `;
      params = [roomId, before, parsedLimit];
    } else {
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count FROM message_reads WHERE message_id = m.id
        ) rc ON true
        WHERE m.room_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `;
      params = [roomId, parsedLimit];
    }

    const result = await pool.query(query, params);
    const messages = result.rows;

    // Attach related data
    await attachMedia(messages);
    await attachReplies(messages);
    await attachTranscriptions(messages);
    await attachLinkPreviews(messages);
    await attachReactions(messages, req.user.id);
    await attachTags(messages);

    res.json({ messages });
  } catch (err) {
    logger.error('Get messages error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/rooms/:id/messages/:msgId
 * Soft-delete a message (sender only)
 */
router.delete('/:msgId', async (req, res) => {
  const { msgId } = req.params;
  const userId = req.user.id;

  try {
    const msg = await pool.query(
      'SELECT sender_id, room_id FROM messages WHERE id = $1',
      [msgId]
    );
    if (msg.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }
    if (msg.rows[0].sender_id !== userId) {
      return res.status(403).json({ error: '自分のメッセージのみ削除できます' });
    }

    await pool.query(
      'UPDATE messages SET is_deleted = true, content = null, updated_at = now() WHERE id = $1',
      [msgId]
    );

    const { io } = require('../app');
    const roomId = req.params.id;
    io.to(roomId).emit('message:deleted', { message_id: msgId });

    res.json({ message: '削除しました' });
  } catch (err) {
    logger.error('Delete message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms/:id/messages/:msgId/reactions
 * Toggle a reaction (add or remove)
 */
router.post('/:msgId/reactions', async (req, res) => {
  const { msgId } = req.params;
  const userId = req.user.id;
  const { emoji } = req.body;

  if (!emoji) {
    return res.status(400).json({ error: 'emoji は必須です' });
  }

  try {
    // Check if already reacted
    const existing = await pool.query(
      'SELECT 1 FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [msgId, userId, emoji]
    );

    if (existing.rows.length > 0) {
      // Remove
      await pool.query(
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
        [msgId, userId, emoji]
      );
    } else {
      // Add
      await pool.query(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)',
        [msgId, userId, emoji]
      );
    }

    // Get updated reactions for this message
    const reactions = await pool.query(
      `SELECT emoji, COUNT(*)::int as count,
              BOOL_OR(user_id = $2) as me
       FROM message_reactions WHERE message_id = $1
       GROUP BY emoji ORDER BY MIN(created_at)`,
      [msgId, userId]
    );

    const { io } = require('../app');
    const roomId = req.params.id;
    io.to(roomId).emit('message:reaction', {
      message_id: msgId,
      reactions: reactions.rows,
    });

    res.json({ reactions: reactions.rows });
  } catch (err) {
    logger.error('Reaction error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
