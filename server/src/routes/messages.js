const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');
const { MESSAGES_DEFAULT_LIMIT, MESSAGES_MAX_LIMIT } = require('../constants/config');
const { attachMedia, attachReplies, attachForwards, attachTranscriptions, attachLinkPreviews, attachReactions, attachTags, attachStamps } = require('../services/messageAttachments');

const router = express.Router({ mergeParams: true });

router.use(authenticate, requireMember);

/**
 * POST /api/rooms/:id/messages
 * Send a message to a room
 */
router.post('/', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { content, type = 'text', reply_to, forwarded_from } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'メッセージ内容は必須です' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to, forwarded_from)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [roomId, userId, content.trim(), type, reply_to || null, forwarded_from || null]
    );

    const message = result.rows[0];

    // Update per-user stamp usage
    if (type === 'stamp' && content) {
      pool.query(
        `INSERT INTO user_stamp_usage (user_id, pack_id, last_used_at)
         VALUES ($1, (SELECT pack_id FROM stamps WHERE id = $2), NOW())
         ON CONFLICT (user_id, pack_id) DO UPDATE SET last_used_at = NOW()`,
        [userId, content.trim()]
      ).catch(() => {});
    }

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
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
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
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
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
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
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
    await attachForwards(messages);
    await attachTranscriptions(messages);
    await attachLinkPreviews(messages);
    await attachReactions(messages, req.user.id);
    await attachTags(messages);
    await attachStamps(messages);

    res.json({ messages });
  } catch (err) {
    logger.error('Get messages error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PATCH /api/rooms/:id/messages/:msgId/publish
 * Toggle publish status for announcement messages
 */
router.patch('/:msgId/publish', async (req, res) => {
  const roomId = req.params.id;
  const { msgId } = req.params;
  const userId = req.user.id;
  const { is_published } = req.body;

  try {
    // Check room is announcement
    const roomResult = await pool.query(
      'SELECT is_announcement FROM rooms WHERE id = $1',
      [roomId]
    );
    if (!roomResult.rows[0]?.is_announcement) {
      return res.status(400).json({ error: 'お知らせルームのみ操作可能です' });
    }

    // Check message exists
    const msgResult = await pool.query(
      'SELECT sender_id, is_deleted FROM messages WHERE id = $1 AND room_id = $2',
      [msgId, roomId]
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }
    if (msgResult.rows[0].is_deleted) {
      return res.status(400).json({ error: '削除済みメッセージは操作できません' });
    }

    // Permission: sender or room admin
    const isOwner = msgResult.rows[0].sender_id === userId;
    if (!isOwner) {
      const adminCheck = await pool.query(
        "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 AND role = 'admin'",
        [roomId, userId]
      );
      if (adminCheck.rows.length === 0) {
        return res.status(403).json({ error: '送信者またはグループ管理者のみ操作できます' });
      }
    }

    const result = await pool.query(
      'UPDATE messages SET is_published = $1 WHERE id = $2 RETURNING id, is_published',
      [is_published, msgId]
    );

    // Socket.IO broadcast
    const { io } = require('../app');
    io.to(roomId).emit('message:published', { message_id: msgId, is_published });

    res.json({ message: result.rows[0] });
  } catch (err) {
    logger.error('Publish toggle error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/rooms/:id/messages/:msgId
 * Edit message content (policy-based: none/sender/member)
 */
router.put('/:msgId', async (req, res) => {
  const roomId = req.params.id;
  const { msgId } = req.params;
  const userId = req.user.id;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'メッセージ内容は必須です' });
  }

  try {
    // Get message and room policy
    const msgResult = await pool.query(
      `SELECT m.sender_id, m.content, m.type, m.is_deleted, r.message_edit_policy
       FROM messages m JOIN rooms r ON r.id = m.room_id
       WHERE m.id = $1 AND m.room_id = $2`,
      [msgId, roomId]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const msg = msgResult.rows[0];

    if (msg.is_deleted) {
      return res.status(400).json({ error: '削除済みメッセージは編集できません' });
    }

    if (msg.type === 'system' || msg.type === 'stamp') {
      return res.status(400).json({ error: 'このメッセージは編集できません' });
    }

    // 初回キャプション追加（contentがnullかつ送信者本人）は常に許可
    const isFirstCaption = !msg.content && msg.sender_id === userId;

    if (!isFirstCaption) {
      if (msg.message_edit_policy === 'none') {
        return res.status(403).json({ error: 'このルームではメッセージ編集が許可されていません' });
      }

      if (msg.message_edit_policy === 'sender' && msg.sender_id !== userId) {
        return res.status(403).json({ error: '送信者のみ編集できます' });
      }

      if (msg.message_edit_policy === 'member') {
        const memberCheck = await pool.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, userId]
        );
        if (memberCheck.rows.length === 0) {
          return res.status(403).json({ error: 'ルームメンバーのみ編集できます' });
        }
      }
    }

    // Save current content to edit history (skip if first caption - no previous content)
    let newVersion = 0;
    if (msg.content) {
      const versionResult = await pool.query(
        'SELECT COALESCE(MAX(version), 0) + 1 as next FROM message_edits WHERE message_id = $1',
        [msgId]
      );
      newVersion = versionResult.rows[0].next;

      await pool.query(
        'INSERT INTO message_edits (message_id, version, content, edited_by) VALUES ($1, $2, $3, $4)',
        [msgId, newVersion, msg.content, userId]
      );
    }

    // Update message
    const updateResult = await pool.query(
      'UPDATE messages SET content = $1, is_edited = true, updated_at = now() WHERE id = $2 RETURNING *',
      [content.trim(), msgId]
    );

    // Socket.IO broadcast
    const { io } = require('../app');
    io.to(roomId).emit('message:updated', {
      message_id: msgId,
      content: content.trim(),
      is_edited: true,
      edited_by: userId,
      edited_by_name: req.user.display_name,
    });

    // Webhook
    const { fireWebhooks } = require('../services/webhook');
    fireWebhooks('message.updated', roomId, {
      room: { id: roomId },
      message: {
        id: msgId,
        content: content.trim(),
        previous_content: msg.content,
        version: newVersion,
        sender: { id: msg.sender_id },
        edited_by: { id: userId, display_name: req.user.display_name },
      },
    });

    res.json({ message: updateResult.rows[0] });
  } catch (err) {
    logger.error('Edit message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/messages/:msgId/edits
 * Get message edit history
 */
router.get('/:msgId/edits', async (req, res) => {
  const roomId = req.params.id;
  const { msgId } = req.params;
  const userId = req.user.id;

  try {
    // Check room member
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'ルームメンバーのみ閲覧できます' });
    }

    const result = await pool.query(
      `SELECT me.version, me.content, me.edited_by, me.created_at, u.display_name AS edited_by_name
       FROM message_edits me
       LEFT JOIN users u ON u.id = me.edited_by
       WHERE me.message_id = $1
       ORDER BY me.version DESC`,
      [msgId]
    );

    res.json({ edits: result.rows });
  } catch (err) {
    logger.error('Get message edits error:', err);
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

    // Webhook notification
    const { fireWebhooks } = require('../services/webhook');
    fireWebhooks('message.deleted', roomId, {
      room: { id: roomId },
      message: { id: msgId, sender: { id: userId, display_name: req.user.display_name } },
    });

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

    // Webhook notification (追加時のみ)
    if (existing.rows.length === 0) {
      const { fireWebhooks } = require('../services/webhook');
      fireWebhooks('reaction.added', roomId, {
        room: { id: roomId },
        message: { id: msgId },
        reaction: { emoji, user: { id: userId, display_name: req.user.display_name } },
      });
    }

    res.json({ reactions: reactions.rows });
  } catch (err) {
    logger.error('Reaction error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
