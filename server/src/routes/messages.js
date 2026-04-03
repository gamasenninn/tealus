const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');

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
    console.error('Send message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/messages
 * Get message history with cursor-based pagination
 */
router.get('/', async (req, res) => {
  const roomId = req.params.id;
  const { before, limit = 20 } = req.query;
  const parsedLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);

  try {
    let query;
    let params;

    if (before) {
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

    // Attach media info to messages that have media
    if (messages.length > 0) {
      const messageIds = messages.map(m => m.id);
      const mediaResult = await pool.query(
        `SELECT * FROM message_media WHERE message_id = ANY($1)`,
        [messageIds]
      );
      const mediaByMessage = {};
      for (const media of mediaResult.rows) {
        if (!mediaByMessage[media.message_id]) {
          mediaByMessage[media.message_id] = [];
        }
        mediaByMessage[media.message_id].push(media);
      }
      for (const msg of messages) {
        msg.media = mediaByMessage[msg.id] || [];
      }
    }

    // Attach reply_to message info
    const replyIds = messages.filter(m => m.reply_to).map(m => m.reply_to);
    if (replyIds.length > 0) {
      const replyResult = await pool.query(
        `SELECT m.id, m.content, m.type, m.sender_id, u.display_name AS sender_display_name,
                vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN LATERAL (
           SELECT formatted_text, raw_text FROM voice_transcriptions
           WHERE message_id = m.id ORDER BY version DESC LIMIT 1
         ) vt ON m.type = 'voice'
         WHERE m.id = ANY($1)`,
        [replyIds]
      );
      const replyMap = {};
      for (const r of replyResult.rows) {
        if (r.type === 'voice' && !r.content) {
          r.content = r.transcription_text || r.transcription_raw || null;
        }
        replyMap[r.id] = r;
      }
      for (const msg of messages) {
        msg.reply_to_message = msg.reply_to ? (replyMap[msg.reply_to] || null) : null;
      }
    }

    // Attach transcription for voice messages
    const voiceIds = messages.filter(m => m.type === 'voice').map(m => m.id);
    if (voiceIds.length > 0) {
      const transResult = await pool.query(
        `SELECT DISTINCT ON (message_id) message_id, raw_text, formatted_text, status, version
         FROM voice_transcriptions
         WHERE message_id = ANY($1)
         ORDER BY message_id, version DESC`,
        [voiceIds]
      );
      const transMap = {};
      for (const t of transResult.rows) {
        transMap[t.message_id] = t;
      }
      for (const msg of messages) {
        if (msg.type === 'voice') {
          msg.transcription = transMap[msg.id] || null;
        }
      }
    }

    // Attach link previews
    if (messages.length > 0) {
      const msgIds = messages.map(m => m.id);
      const lpResult = await pool.query(
        'SELECT * FROM link_previews WHERE message_id = ANY($1)',
        [msgIds]
      );
      const lpMap = {};
      for (const lp of lpResult.rows) {
        lpMap[lp.message_id] = lp;
      }
      for (const msg of messages) {
        msg.link_preview = lpMap[msg.id] || null;
      }

      // Attach reactions
      const reactResult = await pool.query(
        `SELECT message_id, emoji, COUNT(*)::int as count,
                BOOL_OR(user_id = $2) as me
         FROM message_reactions WHERE message_id = ANY($1)
         GROUP BY message_id, emoji ORDER BY MIN(created_at)`,
        [msgIds, req.user.id]
      );
      const reactMap = {};
      for (const r of reactResult.rows) {
        if (!reactMap[r.message_id]) reactMap[r.message_id] = [];
        reactMap[r.message_id].push(r);
      }
      for (const msg of messages) {
        msg.reactions = reactMap[msg.id] || [];
      }
    }

    res.json({ messages });
  } catch (err) {
    console.error('Get messages error:', err);
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
    console.error('Delete message error:', err);
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
    console.error('Reaction error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
