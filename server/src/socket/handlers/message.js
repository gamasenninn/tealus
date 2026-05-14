const logger = require('../../utils/logger');
const pool = require('../../db/pool');
const { processLinkPreviews } = require('../../services/linkPreview');
const { sendPushToOfflineMembers } = require('../../services/push');

/**
 * Fetch reply_to message info with transcription fallback
 */
async function fetchReplyMessage(replyToId) {
  const result = await pool.query(
    `SELECT m.id, m.content, m.type, m.sender_id, u.display_name AS sender_display_name,
            vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
     FROM messages m JOIN users u ON u.id = m.sender_id
     LEFT JOIN LATERAL (
       SELECT formatted_text, raw_text FROM voice_transcriptions
       WHERE message_id = m.id ORDER BY version DESC LIMIT 1
     ) vt ON m.type = 'voice'
     WHERE m.id = $1`,
    [replyToId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  if (r.type === 'voice' && !r.content) {
    r.content = r.transcription_text || r.transcription_raw || null;
  }
  return r;
}

/**
 * Fetch forwarded_from message info (#166) — includes room_name
 * Excludes deleted messages (returns null).
 */
async function fetchForwardMessage(forwardId) {
  const result = await pool.query(
    `SELECT m.id, m.content, m.type, m.sender_id, m.is_deleted,
            u.display_name AS sender_display_name,
            r.name AS room_name, r.type AS room_type,
            vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     JOIN rooms r ON r.id = m.room_id
     LEFT JOIN LATERAL (
       SELECT formatted_text, raw_text FROM voice_transcriptions
       WHERE message_id = m.id ORDER BY version DESC LIMIT 1
     ) vt ON m.type = 'voice'
     WHERE m.id = $1 AND m.is_deleted = false`,
    [forwardId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  if (r.type === 'voice' && !r.content) {
    r.content = r.transcription_text || r.transcription_raw || null;
  }
  return r;
}

/**
 * Handle message:send event
 */
function registerMessageHandler(socket, io) {
  socket.on('message:send', async (data) => {
    const { room_id, content, type = 'text', reply_to, forwarded_from } = data;
    logger.debug(`message:send user=${socket.user.id} room=${room_id} type=${type}`);

    if (!room_id || !content || content.trim() === '') return;

    // Verify membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, socket.user.id]
    );
    if (memberCheck.rows.length === 0) return;

    try {
      const result = await pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type, reply_to, forwarded_from)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [room_id, socket.user.id, content.trim(), type, reply_to || null, forwarded_from || null]
      );

      const message = {
        ...result.rows[0],
        sender_display_name: socket.user.display_name,
        sender_avatar_url: socket.user.avatar_url,
        reply_to_message: reply_to ? await fetchReplyMessage(reply_to) : null,
        forwarded_from_message: forwarded_from ? await fetchForwardMessage(forwarded_from) : null,
      };

      io.to(room_id).emit('message:new', message);

      // Push notification（オフラインユーザー向け）
      const { getOnlineUserIds } = require('../index');
      const onlineUserIds = new Set(getOnlineUserIds());
      sendPushToOfflineMembers(room_id, socket.user.id, {
        title: socket.user.display_name,
        body: (content || '').slice(0, 100) || (type === 'voice' ? '🎤 音声メッセージ' : '📎 ファイル'),
        data: { roomId: room_id, messageId: message.id },
      }, onlineUserIds);

      // Webhook notification
      const { fireWebhooks } = require('../../services/webhook');
      fireWebhooks('message.created', room_id, {
        room: { id: room_id },
        message: { id: message.id, type, content: content?.trim(), reply_to: reply_to || null, reply_to_message: message.reply_to_message || null, sender: { id: socket.user.id, display_name: socket.user.display_name } },
      });

      // Async link preview
      if (content && type === 'text') {
        processLinkPreviews(result.rows[0].id, content, io, room_id).catch(() => {});
      }
    } catch (err) {
      logger.error('Socket message:send error:', err);
    }
  });
}

module.exports = { registerMessageHandler, fetchReplyMessage, fetchForwardMessage };
