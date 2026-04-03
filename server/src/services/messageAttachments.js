const pool = require('../db/pool');

/**
 * Attach media info to messages
 */
async function attachMedia(messages) {
  if (messages.length === 0) return;
  const ids = messages.map(m => m.id);
  const result = await pool.query(
    'SELECT * FROM message_media WHERE message_id = ANY($1)',
    [ids]
  );
  const map = {};
  for (const media of result.rows) {
    if (!map[media.message_id]) map[media.message_id] = [];
    map[media.message_id].push(media);
  }
  for (const msg of messages) {
    msg.media = map[msg.id] || [];
  }
}

/**
 * Attach reply_to message info (with voice transcription fallback)
 */
async function attachReplies(messages) {
  const replyIds = messages.filter(m => m.reply_to).map(m => m.reply_to);
  if (replyIds.length === 0) return;
  const result = await pool.query(
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
  const map = {};
  for (const r of result.rows) {
    if (r.type === 'voice' && !r.content) {
      r.content = r.transcription_text || r.transcription_raw || null;
    }
    map[r.id] = r;
  }
  for (const msg of messages) {
    msg.reply_to_message = msg.reply_to ? (map[msg.reply_to] || null) : null;
  }
}

/**
 * Attach transcription for voice messages
 */
async function attachTranscriptions(messages) {
  const voiceIds = messages.filter(m => m.type === 'voice').map(m => m.id);
  if (voiceIds.length === 0) return;
  const result = await pool.query(
    `SELECT DISTINCT ON (message_id) message_id, raw_text, formatted_text, status, version
     FROM voice_transcriptions
     WHERE message_id = ANY($1)
     ORDER BY message_id, version DESC`,
    [voiceIds]
  );
  const map = {};
  for (const t of result.rows) {
    map[t.message_id] = t;
  }
  for (const msg of messages) {
    if (msg.type === 'voice') {
      msg.transcription = map[msg.id] || null;
    }
  }
}

/**
 * Attach link previews
 */
async function attachLinkPreviews(messages) {
  if (messages.length === 0) return;
  const ids = messages.map(m => m.id);
  const result = await pool.query(
    'SELECT * FROM link_previews WHERE message_id = ANY($1)',
    [ids]
  );
  const map = {};
  for (const lp of result.rows) {
    map[lp.message_id] = lp;
  }
  for (const msg of messages) {
    msg.link_preview = map[msg.id] || null;
  }
}

/**
 * Attach reactions with current user's reaction status
 */
async function attachReactions(messages, userId) {
  if (messages.length === 0) return;
  const ids = messages.map(m => m.id);
  const result = await pool.query(
    `SELECT message_id, emoji, COUNT(*)::int as count,
            BOOL_OR(user_id = $2) as me
     FROM message_reactions WHERE message_id = ANY($1)
     GROUP BY message_id, emoji ORDER BY MIN(created_at)`,
    [ids, userId]
  );
  const map = {};
  for (const r of result.rows) {
    if (!map[r.message_id]) map[r.message_id] = [];
    map[r.message_id].push(r);
  }
  for (const msg of messages) {
    msg.reactions = map[msg.id] || [];
  }
}

module.exports = { attachMedia, attachReplies, attachTranscriptions, attachLinkPreviews, attachReactions };
