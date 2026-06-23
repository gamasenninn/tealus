const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');
const { upload, getMessageType, getSubdir, decodeFileName } = require('../middleware/upload');
const { generateThumbnail } = require('../services/thumbnail');
const { MAX_UPLOAD_FILES } = require('../constants/config');

const router = express.Router({ mergeParams: true });

/**
 * POST /api/rooms/:id/media
 * Upload one or more files and create a media message
 * Supports: upload.single('file') or upload.array('files', 20)
 */
router.post('/', authenticate, requireMember, (req, res, next) => {
  upload.array('files', MAX_UPLOAD_FILES)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'ファイルサイズが上限を超えています（最大100MB）' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  // Support both single file (field: 'file') and multiple files (field: 'files')
  const files = req.files || (req.file ? [req.file] : []);
  if (files.length === 0) {
    return res.status(400).json({ error: 'ファイルが添付されていません' });
  }

  // Determine message type from first file
  const messageType = getMessageType(files[0].mimetype);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create one message for all files
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [roomId, userId, messageType]
    );
    const message = msgResult.rows[0];

    const mediaRecords = [];

    for (const file of files) {
      const subdir = getSubdir(file.mimetype);
      const relativePath = `${subdir}/${file.filename}`;

      // Generate thumbnail for images
      const thumbnailPath = await generateThumbnail(file.path, file.mimetype);

      // Get image dimensions
      let width = null;
      let height = null;
      if (file.mimetype.startsWith('image/')) {
        try {
          const sharp = require('sharp');
          const metadata = await sharp(file.path).metadata();
          width = metadata.width;
          height = metadata.height;
        } catch (e) {
          // Ignore metadata errors
        }
      }

      const mediaResult = await client.query(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height, thumbnail_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [message.id, relativePath, decodeFileName(file.originalname), file.mimetype, file.size, width, height, thumbnailPath]
      );
      mediaRecords.push(mediaResult.rows[0]);
    }

    await client.query('COMMIT');

    // Broadcast via Socket.IO
    const { io } = require('../app');
    const fullMessage = {
      ...message,
      sender_display_name: req.user.display_name,
      sender_avatar_url: req.user.avatar_url,
      media: mediaRecords,
    };
    io.to(roomId).emit('message:new', fullMessage);

    res.status(201).json({
      message,
      media: mediaRecords,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Media upload error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

/**
 * GET /api/rooms/:id/media/gallery
 * Media gallery — list all media in a room with optional tag filter
 */
router.get('/gallery', authenticate, requireMember, async (req, res) => {
  const roomId = req.params.id;
  const { tag, category, offset = 0, limit = 30 } = req.query;
  const limitNum = Math.min(parseInt(limit) || 30, 100);
  const offsetNum = parseInt(offset) || 0;

  // Category to mime_type prefix mapping
  const categoryMap = {
    image: 'image/%',
    video: 'video/%',
    audio: 'audio/%',
    document: null, // special handling below
  };

  try {
    const conditions = ['m.room_id = $1', 'm.is_deleted = false'];
    const params = [roomId];
    let paramIdx = 2;

    if (tag) {
      conditions.push(`mt.tag_id = $${paramIdx++}`);
      params.push(tag);
    }

    if (category && category in categoryMap) {
      if (category === 'document') {
        conditions.push(`mm.mime_type NOT LIKE 'image/%' AND mm.mime_type NOT LIKE 'video/%' AND mm.mime_type NOT LIKE 'audio/%'`);
      } else {
        conditions.push(`mm.mime_type LIKE $${paramIdx++}`);
        params.push(categoryMap[category]);
      }
    }

    const tagJoin = tag ? 'JOIN message_tags mt ON mt.message_id = m.id' : '';
    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT mm.*, m.sender_id, m.created_at AS message_created_at,
             u.display_name AS sender_display_name
      FROM message_media mm
      JOIN messages m ON m.id = mm.message_id
      JOIN users u ON u.id = m.sender_id
      ${tagJoin}
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(limitNum + 1, offsetNum);

    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limitNum;
    const media = hasMore ? result.rows.slice(0, limitNum) : result.rows;

    res.json({ media, has_more: hasMore });
  } catch (err) {
    logger.error('Media gallery error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms/:id/media/forward
 * 既存 message (image / video / file) を別 room へリンク方式で転送
 * (= file_path 共有、binary 重複なし、DB schema 変更なし)
 *
 * body: { source_message_id: UUID }
 * response 201: { message: { ...full message with media + forwarded_from_message... } }
 *
 * 設計:
 * - 元 message の type は image / video / file 限定 (= text は socket 経路、voice / stamp は後 phase)
 * - 元 room の member check 必須 (= 自分が見れた message しか転送できない invariant)
 * - message_media は INSERT-FROM-SELECT で全 row 複製、file_path 共有 (= disk binary 1 つ)
 */
const FORWARDABLE_MEDIA_TYPES = ['image', 'video', 'file'];
router.post('/forward', authenticate, requireMember, async (req, res) => {
  const targetRoomId = req.params.id;
  const userId = req.user.id;
  const { source_message_id } = req.body;

  if (!source_message_id) {
    return res.status(400).json({ error: 'source_message_id は必須です' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const srcResult = await client.query(
      'SELECT id, room_id, type, content, is_deleted FROM messages WHERE id = $1',
      [source_message_id]
    );
    if (srcResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '元メッセージが見つかりません' });
    }
    const src = srcResult.rows[0];
    if (src.is_deleted) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '削除済みメッセージは転送できません' });
    }
    if (!FORWARDABLE_MEDIA_TYPES.includes(src.type)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'このメッセージ種別は転送できません' });
    }

    const memberCheck = await client.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [src.room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'メッセージへのアクセス権限がありません' });
    }

    const insertMsg = await client.query(
      `INSERT INTO messages (room_id, sender_id, type, content, forwarded_from)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [targetRoomId, userId, src.type, src.content, source_message_id]
    );
    const newMessage = insertMsg.rows[0];

    await client.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height, thumbnail_path)
       SELECT $1, file_path, file_name, mime_type, file_size, width, height, thumbnail_path
       FROM message_media WHERE message_id = $2`,
      [newMessage.id, source_message_id]
    );

    await client.query('COMMIT');

    const { attachMedia, attachForwards } = require('../services/messageAttachments');
    const fullMessage = {
      ...newMessage,
      sender_display_name: req.user.display_name,
      sender_avatar_url: req.user.avatar_url,
    };
    await attachMedia([fullMessage]);
    await attachForwards([fullMessage]);

    const { io } = require('../app');
    io.to(targetRoomId).emit('message:new', fullMessage);

    try {
      const { sendPushToOfflineMembers } = require('../services/push');
      const { getOnlineUserIds } = require('../socket');
      const typeLabel = src.type === 'image' ? '画像' : src.type === 'video' ? '動画' : 'ファイル';
      sendPushToOfflineMembers(targetRoomId, userId, {
        title: req.user.display_name,
        body: `📎 ${typeLabel}を転送`,
        data: { roomId: targetRoomId, messageId: fullMessage.id },
      }, new Set(getOnlineUserIds()));
    } catch (e) {
      logger.warn('Push notification failed: ' + e.message);
    }

    try {
      const { fireWebhooks } = require('../services/webhook');
      fireWebhooks('message.created', targetRoomId, {
        room: { id: targetRoomId },
        message: {
          id: fullMessage.id,
          type: src.type,
          content: fullMessage.content,
          forwarded_from: source_message_id,
          sender: { id: userId, display_name: req.user.display_name },
        },
      });
    } catch (e) {
      logger.warn('Webhook fire failed: ' + e.message);
    }

    res.status(201).json({ message: fullMessage });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    logger.error('Media forward error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

module.exports = router;
