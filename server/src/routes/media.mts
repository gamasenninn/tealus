import { getOnlineUserIds } from '../socket/index.mts';
import { getIo } from '../io-registry.mts';
import express from 'express';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember } from '../middleware/roomAccess.mts';
import { upload, getMessageType, getSubdir, decodeFileName } from '../middleware/upload.mts';
import { generateThumbnail } from '../services/thumbnail.mts';
import { MAX_UPLOAD_FILES } from '../constants/config.mts';
import { attachMedia, attachForwards } from '../services/messageAttachments.mts';
import type { AttachableMessage } from '../services/messageAttachments.mts';
import { sendPushToOfflineMembers } from '../services/push.mts';
import { fireWebhooks } from '../services/webhook.mts';

export const router = express.Router({ mergeParams: true });

/** messages 行 (= docs/02_DB設計.md) */
interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  reply_to: string | null;
  forwarded_from: string | null;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

/** message_media 行 */
interface MediaRow {
  id: string;
  message_id: string;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
  created_at: Date;
}

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
  const userId = req.user!.id;

  // Support both single file (field: 'file') and multiple files (field: 'files')
  const files = (req.files as Express.Multer.File[] | undefined) || (req.file ? [req.file] : []);
  if (files.length === 0) {
    return res.status(400).json({ error: 'ファイルが添付されていません' });
  }

  // Determine message type from first file
  const messageType = getMessageType(files[0].mimetype);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create one message for all files
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [roomId, userId, messageType]
    );
    const message = msgResult.rows[0];

    const mediaRecords: MediaRow[] = [];

    for (const file of files) {
      const subdir = getSubdir(file.mimetype);
      const relativePath = `${subdir}/${file.filename}`;

      // Generate thumbnail for images
      const thumbnailPath = await generateThumbnail(file.path, file.mimetype);

      // Get image dimensions
      let width: number | null = null;
      let height: number | null = null;
      if (file.mimetype.startsWith('image/')) {
        try {
          const sharp = (await import('sharp')).default;
          const metadata = await sharp(file.path).metadata();
          width = metadata.width ?? null;
          height = metadata.height ?? null;
        } catch {
          // Ignore metadata errors
        }
      }

      const mediaResult = await client.query<MediaRow>(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height, thumbnail_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [message.id, relativePath, decodeFileName(file.originalname), file.mimetype, file.size, width, height, thumbnailPath]
      );
      mediaRecords.push(mediaResult.rows[0]);
    }

    await client.query('COMMIT');

    // Broadcast via Socket.IO
    const io = getIo();
    const fullMessage = {
      ...message,
      sender_display_name: req.user!.display_name,
      sender_avatar_url: req.user!.avatar_url,
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
  const { tag, category, offset = 0, limit = 30 } = req.query as {
    tag?: string;
    category?: string;
    offset?: string | number;
    limit?: string | number;
  };
  const limitNum = Math.min(parseInt(String(limit)) || 30, 100);
  const offsetNum = parseInt(String(offset)) || 0;

  // Category to mime_type prefix mapping
  const categoryMap: Record<string, string | null> = {
    image: 'image/%',
    video: 'video/%',
    audio: 'audio/%',
    document: null, // special handling below
  };

  try {
    const conditions = ['m.room_id = $1', 'm.is_deleted = false'];
    const params: unknown[] = [roomId];
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

    const result = await pool.query<MediaRow & { sender_id: string; message_created_at: Date; sender_display_name: string }>(query, params);
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
  const targetRoomId = (req.params as { id: string }).id;
  const userId = req.user!.id;
  const { source_message_id } = req.body as { source_message_id?: string };

  if (!source_message_id) {
    return res.status(400).json({ error: 'source_message_id は必須です' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const srcResult = await client.query<Pick<MessageRow, 'id' | 'room_id' | 'type' | 'content' | 'is_deleted'>>(
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

    const insertMsg = await client.query<MessageRow>(
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

    const fullMessage: AttachableMessage = {
      ...newMessage,
      sender_display_name: req.user!.display_name,
      sender_avatar_url: req.user!.avatar_url,
    };
    await attachMedia([fullMessage]);
    await attachForwards([fullMessage]);

    const io = getIo();
    io.to(targetRoomId).emit('message:new', fullMessage);

    try {
      
      const typeLabel = src.type === 'image' ? '画像' : src.type === 'video' ? '動画' : 'ファイル';
      sendPushToOfflineMembers(targetRoomId, userId, {
        title: req.user!.display_name,
        body: `📎 ${typeLabel}を転送`,
        data: { roomId: targetRoomId, messageId: fullMessage.id },
      }, new Set(getOnlineUserIds()));
    } catch (e) {
      logger.warn('Push notification failed: ' + (e instanceof Error ? e.message : String(e)));
    }

    try {
      fireWebhooks('message.created', targetRoomId, {
        room: { id: targetRoomId },
        message: {
          id: fullMessage.id,
          type: src.type,
          content: fullMessage.content,
          forwarded_from: source_message_id,
          sender: { id: userId, display_name: req.user!.display_name },
        },
      });
    } catch (e) {
      logger.warn('Webhook fire failed: ' + (e instanceof Error ? e.message : String(e)));
    }

    res.status(201).json({ message: fullMessage });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    logger.error('Media forward error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});
