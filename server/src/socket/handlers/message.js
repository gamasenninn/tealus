const pool = require('../../db/pool');
const { processLinkPreviews } = require('../../services/linkPreview');

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
 * Handle message:send event
 */
function registerMessageHandler(socket, io) {
  socket.on('message:send', async (data) => {
    const { room_id, content, type = 'text', reply_to } = data;

    if (!room_id || !content || content.trim() === '') return;

    // Verify membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, socket.user.id]
    );
    if (memberCheck.rows.length === 0) return;

    try {
      const result = await pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [room_id, socket.user.id, content.trim(), type, reply_to || null]
      );

      const message = {
        ...result.rows[0],
        sender_display_name: socket.user.display_name,
        sender_avatar_url: socket.user.avatar_url,
        reply_to_message: reply_to ? await fetchReplyMessage(reply_to) : null,
      };

      io.to(room_id).emit('message:new', message);

      // Async link preview
      if (content && type === 'text') {
        processLinkPreviews(result.rows[0].id, content, io, room_id).catch(() => {});
      }
    } catch (err) {
      console.error('Socket message:send error:', err);
    }
  });
}

module.exports = { registerMessageHandler, fetchReplyMessage };
