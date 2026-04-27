const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { upload, MEDIA_ROOT } = require('../middleware/upload');
const { generateThumbnail } = require('../services/thumbnail');

const router = express.Router();

router.use(authenticate);

// --- TTS audio cache (in-memory, transient) ---
// agent-server から POST /tts-audio で WAV を受信、room に Socket.IO でURL通知。
// client は GET /tts-audio/:id で取得して <audio> で再生。
// 5 分 TTL で自動削除 (TTS は永続化不要)。
const TTS_AUDIO_TTL_MS = 5 * 60 * 1000;
const TTS_AUDIO_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ttsAudioCache = new Map(); // id → { buffer, contentType, expiresAt }
const ttsAudioMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TTS_AUDIO_MAX_SIZE },
});

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of ttsAudioCache) {
    if (entry.expiresAt < now) ttsAudioCache.delete(id);
  }
}, 60_000).unref();

/**
 * POST /api/bot/push
 * Send a message to a room (with Socket.IO broadcast)
 */
router.post('/push', async (req, res) => {
  const { room_id, content, type = 'text' } = req.body;
  const userId = req.user.id;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content は必須です' });
  }

  try {
    // Check membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    // Insert message
    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [room_id, userId, content.trim(), type]
    );

    const message = result.rows[0];

    // Socket.IO broadcast (the key difference from regular REST API)
    const { io } = require('../app');
    io.to(room_id).emit('message:new', {
      ...message,
      sender_display_name: req.user.display_name,
      sender_avatar_url: req.user.avatar_url,
    });

    // Webhook notification
    const { fireWebhooks } = require('../services/webhook');
    fireWebhooks('message.created', room_id, {
      room: { id: room_id },
      message: { id: message.id, type, content: content?.trim(), sender: { id: req.user.id, display_name: req.user.display_name } },
    });

    logger.info(`Bot push: ${req.user.display_name} → room ${room_id}`);

    res.status(201).json({ message });
  } catch (err) {
    logger.error('Bot push error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/bot/tts-speak
 * Notify all room members to speak the given text via their browser's Web Speech API.
 * Used by agent-server when TTS_PROVIDER=browser (no DB write, no message creation).
 */
router.post('/tts-speak', async (req, res) => {
  const { room_id, text } = req.body;
  const userId = req.user.id;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text は必須です' });
  }

  try {
    // Check membership (same gate as /push)
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    // Socket.IO broadcast — clients with ttsReadAloud=on will speak via Web Speech API
    const { io } = require('../app');
    io.to(room_id).emit('tts:speak', {
      text: text.trim(),
      room_id,
      sender_id: userId,
    });

    res.status(202).json({ ok: true });
  } catch (err) {
    logger.error('Bot tts-speak error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/bot/tts-audio
 * Receive a synthesized WAV from agent-server and broadcast a URL to room members.
 * The WAV stays in memory cache (5 min TTL); clients fetch via GET /tts-audio/:id.
 *
 * This is the new TTS delivery path that replaces mediasoup PlainTransport
 * for aivis-cloud auto-readout. See #189.
 */
router.post('/tts-audio', ttsAudioMemoryUpload.single('audio'), async (req, res) => {
  const { room_id } = req.body;
  const userId = req.user.id;
  const file = req.file;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }
  if (!file) {
    return res.status(400).json({ error: 'audio ファイルが添付されていません' });
  }

  try {
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    const id = crypto.randomBytes(16).toString('hex');
    ttsAudioCache.set(id, {
      buffer: file.buffer,
      contentType: file.mimetype || 'audio/wav',
      expiresAt: Date.now() + TTS_AUDIO_TTL_MS,
    });

    const url = `/api/bot/tts-audio/${id}`;
    const { io } = require('../app');
    io.to(room_id).emit('tts:audio', {
      url,
      room_id,
      sender_id: userId,
    });

    res.status(202).json({ ok: true, id, url });
  } catch (err) {
    logger.error('Bot tts-audio error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/bot/tts-audio/:id
 * Serve a cached TTS WAV. Returns 404 if expired or not found.
 */
router.get('/tts-audio/:id', (req, res) => {
  const entry = ttsAudioCache.get(req.params.id);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) ttsAudioCache.delete(req.params.id);
    return res.status(404).json({ error: '音声が見つからないか、有効期限切れです' });
  }
  res.set('Content-Type', entry.contentType);
  res.set('Cache-Control', 'no-store');
  res.send(entry.buffer);
});

/**
 * POST /api/bot/status
 * Send a status update to a room (displayed as typing-indicator style, not a message)
 */
router.post('/status', async (req, res) => {
  const { room_id, status, message } = req.body;
  const userId = req.user.id;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }
  if (!status) {
    return res.status(400).json({ error: 'status は必須です' });
  }

  try {
    const { io } = require('../app');
    io.to(room_id).emit('agent:status', {
      agent_id: userId,
      room_id,
      status,
      message: message || '',
      display_name: req.user.display_name,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Bot status error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/bot/push-image
 * Send an image message to a room
 */
router.post('/push-image', upload.single('image'), async (req, res) => {
  const { room_id, content } = req.body;
  const userId = req.user.id;
  const file = req.file;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }
  if (!file) {
    return res.status(400).json({ error: '画像ファイルが添付されていません' });
  }

  const client = await pool.connect();
  try {
    // Check membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      client.release();
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    await client.query('BEGIN');

    // Create image message
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES ($1, $2, $3, 'image')
       RETURNING *`,
      [room_id, userId, content || null]
    );
    const message = msgResult.rows[0];

    // Get image dimensions
    const relativePath = `images/${file.filename}`;
    let width = null;
    let height = null;
    try {
      const sharp = require('sharp');
      const metadata = await sharp(file.path).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch (e) { /* ignore */ }

    // Generate thumbnail
    const thumbnailPath = await generateThumbnail(file.path, file.mimetype);

    // Insert media record
    const mediaResult = await client.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height, thumbnail_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [message.id, relativePath, file.originalname, file.mimetype, file.size, width, height, thumbnailPath]
    );

    await client.query('COMMIT');

    // Socket.IO broadcast
    const { io } = require('../app');
    io.to(room_id).emit('message:new', {
      ...message,
      sender_display_name: req.user.display_name,
      sender_avatar_url: req.user.avatar_url,
      media: [mediaResult.rows[0]],
    });

    logger.info(`Bot push-image: ${req.user.display_name} → room ${room_id}`);
    res.status(201).json({ message, media: [mediaResult.rows[0]] });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Bot push-image error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

/**
 * GET /api/bot/messages?room_id=xxx&since=timestamp
 * Get messages since a timestamp (for polling)
 */
router.get('/messages', async (req, res) => {
  const { room_id, since } = req.query;
  const userId = req.user.id;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }

  try {
    // Check membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    let query;
    let params;

    if (since) {
      query = `
        SELECT m.*, u.display_name AS sender_display_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1 AND m.created_at > $2 AND m.is_deleted = false
        ORDER BY m.created_at ASC
        LIMIT 100
      `;
      params = [room_id, since];
    } else {
      query = `
        SELECT m.*, u.display_name AS sender_display_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1 AND m.is_deleted = false
        ORDER BY m.created_at DESC
        LIMIT 20
      `;
      params = [room_id];
    }

    const result = await pool.query(query, params);
    const messages = result.rows;

    // 音声メッセージに文字起こしを付加
    for (const msg of messages) {
      if (msg.type === 'voice') {
        const trans = await pool.query(
          'SELECT raw_text, formatted_text, status FROM voice_transcriptions WHERE message_id = $1 ORDER BY version DESC LIMIT 1',
          [msg.id]
        );
        if (trans.rows.length > 0) {
          msg.transcription = trans.rows[0];
        }
      }
    }

    res.json({ messages });
  } catch (err) {
    logger.error('Bot messages error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/bot/messages/:id/media
 * Bot がアクセス可能なメッセージのメディア (image / video / voice) を base64 で取得。
 * MCP / AI クライアントから「画像を見る」「音声を取得する」用途。
 *
 * Response:
 *   { message_id, type, mime_type, file_name, file_size, data_base64,
 *     transcription? (voice 時) }
 *
 * 制限: ファイル単位 10MB (それ以上は data 省略、メタのみ)。
 */
const BOT_MEDIA_MAX_SIZE = 10 * 1024 * 1024;
router.get('/messages/:id/media', async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user.id;

  try {
    // メッセージ + メディア + ルーム所属を一括チェック
    const result = await pool.query(`
      SELECT m.id, m.type, m.room_id, m.is_deleted,
             mm.file_path, mm.file_name, mm.mime_type, mm.file_size
      FROM messages m
      LEFT JOIN message_media mm ON mm.message_id = m.id
      WHERE m.id = $1
    `, [messageId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }
    const row = result.rows[0];
    if (row.is_deleted) {
      return res.status(410).json({ error: 'メッセージは削除されています' });
    }
    if (!row.file_path) {
      return res.status(404).json({ error: 'このメッセージにメディアはありません' });
    }

    // Bot のルーム所属確認
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [row.room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    const filePath = path.join(MEDIA_ROOT, row.file_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'ファイルが存在しません' });
    }

    const response = {
      message_id: row.id,
      type: row.type,
      mime_type: row.mime_type,
      file_name: row.file_name,
      file_size: parseInt(row.file_size),
    };

    if (parseInt(row.file_size) > BOT_MEDIA_MAX_SIZE) {
      response.error = `ファイルサイズが上限 (${BOT_MEDIA_MAX_SIZE / 1024 / 1024}MB) を超えています。data_base64 は省略。`;
    } else {
      const buffer = fs.readFileSync(filePath);
      response.data_base64 = buffer.toString('base64');
    }

    // 音声メッセージは文字起こしも一緒に返す (MCP 側でメタとして使える)
    if (row.type === 'voice') {
      const trans = await pool.query(
        'SELECT raw_text, formatted_text, status FROM voice_transcriptions WHERE message_id = $1 ORDER BY version DESC LIMIT 1',
        [messageId]
      );
      if (trans.rows.length > 0) {
        response.transcription = trans.rows[0];
      }
    }

    res.json(response);
  } catch (err) {
    logger.error('Bot get media error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/bot/search
 * AI / MCP クライアント向けの横断検索 endpoint。
 *
 * 仕様: #194 (https://github.com/gamasenninn/tealus/issues/194)
 *
 * - q なし: 単一 SELECT (btree index、~2ms)
 * - q あり: UNION + tag_match CTE (GIN trigram index、~15ms)
 * - 6 種 narrowing filter (q / room_id / sender_id / since / tag_names / type) のいずれか必須
 * - room_members JOIN で Bot の所属 room のみ可視
 */

// LIKE wildcard escape: q に %, _, \ が含まれても安全に substring マッチ
function escapeLike(s) {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// match 前後 ±100 文字の snippet を **match** ハイライト付きで返す
function buildSnippet(text, query, contextChars = 100) {
  if (!text) return '(メディアのみ)';
  if (!query) return text.length > 200 ? text.slice(0, 200) + '...' : text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return text.length > 200 ? text.slice(0, 200) + '...' : text;
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  const before = text.slice(start, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length, end);
  let snippet = `${before}**${match}**${after}`;
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

router.get('/search', async (req, res) => {
  const {
    q, room_id, sender_id, type, tag_names, is_done,
    since, until, limit = 10, offset = 0,
  } = req.query;
  const userId = req.user.id;
  const tagNameList = tag_names
    ? tag_names.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // バリデーション: 6 種 narrowing filter のいずれか必須
  const hasFilter = !!(q || room_id || sender_id || since || tagNameList.length > 0 || type);
  if (!hasFilter) {
    return res.status(400).json({
      error: 'q / room_id / sender_id / since / tag_names / type のうち少なくとも 1 つ必須',
    });
  }
  if (q && q.length > 500) {
    return res.status(400).json({ error: 'q は 500 文字以下' });
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 50);
  const parsedOffset = Math.max(parseInt(offset) || 0, 0);
  const escapedQ = q ? escapeLike(q.trim()) : null;

  try {
    // パラメータと WHERE 句を動的構築
    const params = [];
    let paramIdx = 1;
    const filtersSQL = []; // 共通の追加 WHERE (Case 1 / 2 path で使い回し)

    // bot user (room_members JOIN 用)
    params.push(userId);
    const userIdParamIdx = paramIdx++;

    if (room_id) {
      params.push(room_id);
      filtersSQL.push(`m.room_id = $${paramIdx++}`);
    }
    if (sender_id) {
      params.push(sender_id);
      filtersSQL.push(`m.sender_id = $${paramIdx++}`);
    }
    if (type) {
      params.push(type);
      filtersSQL.push(`m.type = $${paramIdx++}`);
    }
    if (since) {
      params.push(since);
      filtersSQL.push(`m.created_at >= $${paramIdx++}`);
    }
    if (until) {
      params.push(until);
      filtersSQL.push(`m.created_at <= $${paramIdx++}`);
    }

    // tag_match CTE (tag_names 指定時のみ)
    let tagCteSQL = '';
    let tagFilterSQL = '';
    if (tagNameList.length > 0) {
      const tagPlaceholders = tagNameList.map((name) => {
        params.push(name);
        return `$${paramIdx++}`;
      });
      params.push(tagNameList.length);
      const havingParam = paramIdx++;

      let isDoneFilter = '';
      if (is_done !== undefined && is_done !== '') {
        params.push(is_done === 'true' || is_done === true);
        isDoneFilter = ` AND mt.is_done = $${paramIdx++}`;
      }

      tagCteSQL = `
        WITH tag_match AS (
          SELECT mt.message_id
          FROM message_tags mt
          JOIN tags t ON t.id = mt.tag_id
          WHERE t.name IN (${tagPlaceholders.join(', ')})${isDoneFilter}
          GROUP BY mt.message_id
          HAVING COUNT(DISTINCT t.name) = $${havingParam}
        )
      `;
      tagFilterSQL = ` AND m.id IN (SELECT message_id FROM tag_match)`;
    }

    const commonWhere = filtersSQL.length > 0 ? ' AND ' + filtersSQL.join(' AND ') : '';
    const selectFields = `
      m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
      u.display_name AS sender_display_name,
      r.name AS room_name, r.type AS room_type
    `;

    let query;
    if (!escapedQ) {
      // Case 1: q なし — 単一 SELECT (btree index 経由)
      params.push(parsedLimit + 1, parsedOffset);
      const limitIdx = paramIdx++;
      const offsetIdx = paramIdx++;
      query = `
        ${tagCteSQL}
        SELECT ${selectFields},
               vt.formatted_text AS transcription_formatted,
               vt.raw_text AS transcription_raw
        FROM messages m
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $${userIdParamIdx}
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        LEFT JOIN LATERAL (
          SELECT formatted_text, raw_text FROM voice_transcriptions
          WHERE message_id = m.id ORDER BY version DESC LIMIT 1
        ) vt ON m.type = 'voice'
        WHERE NOT m.is_deleted${commonWhere}${tagFilterSQL}
        ORDER BY m.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
    } else {
      // Case 2: q あり — UNION (path_content + path_voice)
      params.push(`%${escapedQ}%`);
      const qIdx = paramIdx++;
      params.push(parsedLimit + 1, parsedOffset);
      const limitIdx = paramIdx++;
      const offsetIdx = paramIdx++;

      // path_voice は type フィルタが 'voice' 以外を強制した場合スキップ
      const skipPathVoice = type && type !== 'voice';
      // path_content は type='voice' が強制された場合スキップ
      const skipPathContent = type === 'voice';

      const pathContentSQL = skipPathContent ? '' : `
        SELECT ${selectFields},
               NULL::text AS transcription_formatted,
               NULL::text AS transcription_raw
        FROM messages m
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $${userIdParamIdx}
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        WHERE NOT m.is_deleted
          AND m.content ILIKE $${qIdx} ESCAPE '\\'${commonWhere}${tagFilterSQL}
      `;

      const pathVoiceSQL = skipPathVoice ? '' : `
        SELECT ${selectFields},
               vt.formatted_text AS transcription_formatted,
               vt.raw_text AS transcription_raw
        FROM messages m
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $${userIdParamIdx}
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        JOIN voice_transcriptions vt ON vt.message_id = m.id
          AND vt.version = (SELECT MAX(version) FROM voice_transcriptions WHERE message_id = m.id)
        WHERE NOT m.is_deleted
          AND m.type = 'voice'
          AND (vt.formatted_text ILIKE $${qIdx} ESCAPE '\\' OR vt.raw_text ILIKE $${qIdx} ESCAPE '\\')${commonWhere}${tagFilterSQL}
      `;

      const unionSQL =
        pathContentSQL && pathVoiceSQL
          ? `(${pathContentSQL}) UNION (${pathVoiceSQL})`
          : pathContentSQL || pathVoiceSQL;

      query = `
        ${tagCteSQL}
        SELECT * FROM (${unionSQL}) u
        ORDER BY created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
    }

    logger.debug(`bot search: q=${q || ''} room=${room_id || 'all'} sender=${sender_id || ''} type=${type || ''} tags=${tagNameList.join(',') || ''} since=${since || ''} until=${until || ''}`);

    const result = await pool.query(query, params);
    const rows = result.rows;
    const hasMore = rows.length > parsedLimit;
    const trimmed = hasMore ? rows.slice(0, parsedLimit) : rows;

    const results = trimmed.map((r) => {
      const text = r.content || r.transcription_formatted || r.transcription_raw || null;
      return {
        message_id: r.id,
        room_id: r.room_id,
        room_name: r.room_type === 'direct' ? r.sender_display_name : r.room_name,
        sender_id: r.sender_id,
        sender_display_name: r.sender_display_name,
        type: r.type,
        created_at: r.created_at,
        snippet: buildSnippet(text, q),
      };
    });

    res.json({
      results,
      has_more: hasMore,
      next_offset: hasMore ? parsedOffset + parsedLimit : null,
    });
  } catch (err) {
    logger.error('Bot search error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/bot/unread?room_id=optional
 * Get unread messages across all rooms or a specific room
 */
router.get('/unread', async (req, res) => {
  const { room_id } = req.query;
  const userId = req.user.id;

  try {
    let query;
    let params;

    if (room_id) {
      // Specific room
      query = `
        SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
               u.display_name AS sender_display_name,
               r.name AS room_name, r.type AS room_type
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        WHERE m.room_id = $1
          AND m.sender_id != $2
          AND m.is_deleted = false
          AND m.created_at > COALESCE(
            (SELECT last_read_at FROM room_read_cursors WHERE room_id = $1 AND user_id = $2),
            '1970-01-01'
          )
        ORDER BY m.created_at ASC
        LIMIT 100
      `;
      params = [room_id, userId];
    } else {
      // All rooms
      query = `
        SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
               u.display_name AS sender_display_name,
               r.name AS room_name, r.type AS room_type
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
        WHERE m.sender_id != $1
          AND m.is_deleted = false
          AND m.created_at > COALESCE(
            (SELECT last_read_at FROM room_read_cursors WHERE room_id = m.room_id AND user_id = $1),
            '1970-01-01'
          )
        ORDER BY m.created_at ASC
        LIMIT 100
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);

    // For voice messages, get transcription
    for (const msg of result.rows) {
      if (msg.type === 'voice') {
        const trans = await pool.query(
          `SELECT formatted_text, raw_text FROM voice_transcriptions
           WHERE message_id = $1 ORDER BY version DESC LIMIT 1`,
          [msg.id]
        );
        if (trans.rows.length > 0) {
          msg.content = trans.rows[0].formatted_text || trans.rows[0].raw_text || msg.content;
        }
      }
    }

    res.json({ messages: result.rows });
  } catch (err) {
    logger.error('Bot unread error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/bot/mark-read
 * Mark messages as read
 */
router.post('/mark-read', async (req, res) => {
  const { message_ids } = req.body;
  const userId = req.user.id;

  if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
    return res.status(400).json({ error: 'message_ids は必須です' });
  }

  try {
    // Find the latest message and its room
    const latestMsg = await pool.query(
      `SELECT m.id, m.room_id, m.created_at FROM messages m
       WHERE m.id = ANY($1)
       ORDER BY m.created_at DESC LIMIT 1`,
      [message_ids]
    );

    if (latestMsg.rows.length > 0) {
      const { id, room_id, created_at } = latestMsg.rows[0];
      await pool.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, $3, $4::timestamptz + interval '1 millisecond')
         ON CONFLICT (room_id, user_id)
         DO UPDATE SET
           last_read_message_id = CASE
             WHEN room_read_cursors.last_read_at < EXCLUDED.last_read_at
             THEN EXCLUDED.last_read_message_id
             ELSE room_read_cursors.last_read_message_id
           END,
           last_read_at = GREATEST(room_read_cursors.last_read_at, EXCLUDED.last_read_at)`,
        [room_id, userId, id, created_at]
      );
    }

    logger.info(`Bot mark-read: ${message_ids.length} messages`);
    res.json({ success: true, count: message_ids.length });
  } catch (err) {
    logger.error('Bot mark-read error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/bot/rooms
 * List rooms the bot belongs to
 */
router.get('/rooms', async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT r.id, r.type, r.name, r.icon_url, r.created_at,
              (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS member_count,
              partner.display_name AS partner_display_name,
              partner.avatar_url AS partner_avatar_url
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       LEFT JOIN LATERAL (
         SELECT u2.display_name, u2.avatar_url
         FROM room_members rm2
         JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != $1
         LIMIT 1
       ) partner ON r.type = 'direct'
       WHERE rm.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    res.json({ rooms: result.rows });
  } catch (err) {
    logger.error('Bot rooms error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/bot/rooms/:id/join
 * Join a room
 */
router.post('/rooms/:id/join', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  try {
    // Check room exists
    const room = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
    if (room.rows.length === 0) {
      return res.status(404).json({ error: E.ROOM_NOT_FOUND });
    }

    // Join (ignore if already member)
    await pool.query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [roomId, userId]
    );

    logger.info(`Bot joined room: ${req.user.display_name} → ${roomId}`);

    res.json({ success: true });
  } catch (err) {
    logger.error('Bot join error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
