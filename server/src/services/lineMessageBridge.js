/**
 * LINE → Tealus post helper
 *
 * LINE webhook で受信した message を Tealus DB に post する helper 群。
 * core SQL pattern は既存 `routes/bot.js` /push-image + `routes/voice.js` から流用、
 * LINE webhook 用 entry point として独立提供 (= Phase 1 では duplicate copy、Phase 2 で
 * 共通 helper 抽出 refactor 想定)。
 *
 * 関連:
 *   - LINE Bridge Phase 1 (= 本日 Day 17 起票予定)
 *   - 既存 reference: routes/bot.js /push-image (line 238-315)、routes/voice.js (line 56-126)
 *   - voice の transcription trigger = `services/transcription.js`
 *
 * @module services/lineMessageBridge
 */
const pool = require('../db/pool');
const logger = require('../utils/logger');

/**
 * text message を Tealus に post
 *
 * @param {Object} params
 * @param {string} params.roomId
 * @param {string} params.senderUserId - LINE bot user の Tealus user id
 * @param {string} params.content - LINE message.text
 * @param {string} [params.replyTo]
 * @param {Object} [params.io] - Socket.IO instance (= broadcast、optional)
 * @returns {Promise<{ message: Object }>}
 */
async function postTextToTealus({ roomId, senderUserId, content, replyTo, io }) {
  if (!roomId) throw new Error('roomId is required');
  if (!senderUserId) throw new Error('senderUserId is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, 'text', $4) RETURNING *`,
      [roomId, senderUserId, content || '', replyTo || null]
    );
    const message = msgResult.rows[0];
    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', { ...message });
    }

    logger.info(`[lineMessageBridge] text post: room=${roomId} msg=${message.id}`);
    return { message };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * image message を Tealus に post
 *
 * @param {Object} params
 * @param {string} params.roomId
 * @param {string} params.senderUserId
 * @param {Object} params.mediaInfo - lineBridge.saveLineContentToFile の return value
 * @param {string} [params.content]
 * @param {string} [params.replyTo]
 * @param {Object} [params.io]
 * @returns {Promise<{ message: Object, media: Object }>}
 */
async function postImageToTealus({ roomId, senderUserId, mediaInfo, content, replyTo, io }) {
  if (!roomId) throw new Error('roomId is required');
  if (!senderUserId) throw new Error('senderUserId is required');
  if (!mediaInfo) throw new Error('mediaInfo is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, 'image', $4) RETURNING *`,
      [roomId, senderUserId, content || null, replyTo || null]
    );
    const message = msgResult.rows[0];

    // image dimensions (= bot.js /push-image 同型、sharp metadata、失敗時は null で続行)
    let width = null;
    let height = null;
    try {
      const sharp = require('sharp');
      const metadata = await sharp(mediaInfo.filePath).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    } catch (e) {
      logger.warn(`[lineMessageBridge] sharp metadata failed: ${e.message}`);
    }

    const mediaResult = await client.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [message.id, mediaInfo.relativePath, mediaInfo.fileName, mediaInfo.mimeType, mediaInfo.fileSize, width, height]
    );
    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', { ...message, media: [mediaResult.rows[0]] });
    }

    logger.info(`[lineMessageBridge] image post: room=${roomId} msg=${message.id} file=${mediaInfo.fileName}`);
    return { message, media: mediaResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * voice message を Tealus に post (= voice.js 同型 + transcribeVoiceMessage 自動 trigger)
 *
 * @param {Object} params
 * @param {string} params.roomId
 * @param {string} params.senderUserId
 * @param {Object} params.mediaInfo - lineBridge.saveLineContentToFile の return value
 * @param {string} [params.replyTo]
 * @param {Object} [params.io]
 * @returns {Promise<{ message: Object, media: Object }>}
 */
async function postVoiceToTealus({ roomId, senderUserId, mediaInfo, replyTo, io }) {
  if (!roomId) throw new Error('roomId is required');
  if (!senderUserId) throw new Error('senderUserId is required');
  if (!mediaInfo) throw new Error('mediaInfo is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, type, reply_to)
       VALUES ($1, $2, 'voice', $3) RETURNING *`,
      [roomId, senderUserId, replyTo || null]
    );
    const message = msgResult.rows[0];

    const mediaResult = await client.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [message.id, mediaInfo.relativePath, mediaInfo.fileName, mediaInfo.mimeType, mediaInfo.fileSize]
    );

    // pending transcription record (= voice.js 同型)
    await client.query(
      `INSERT INTO voice_transcriptions (message_id, status) VALUES ($1, 'pending')`,
      [message.id]
    );

    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', { ...message, media: [mediaResult.rows[0]] });
    }

    // ★ ★ ★ Background transcription trigger (= voice.js line 116-118 同型)
    // organon polyseme inject (= 5/31 Day 15 完成) もここから自動連動
    try {
      const { transcribeVoiceMessage } = require('./transcription');
      transcribeVoiceMessage(message.id, mediaInfo.relativePath, io, roomId).catch(err => {
        logger.error(`[lineMessageBridge] Background transcription error: ${err.message}`);
      });
    } catch (e) {
      logger.warn(`[lineMessageBridge] transcribeVoiceMessage not available: ${e.message}`);
    }

    logger.info(`[lineMessageBridge] voice post: room=${roomId} msg=${message.id} file=${mediaInfo.fileName}`);
    return { message, media: mediaResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  postTextToTealus,
  postImageToTealus,
  postVoiceToTealus,
};
