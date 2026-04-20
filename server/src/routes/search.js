const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/search?q=keyword&room_id=optional&limit=50
 * Search messages across all rooms (or within a specific room)
 * Searches both message content and voice transcriptions
 */
router.get('/', async (req, res) => {
  const { q, room_id, tag_id, is_done, sort, limit = 50, offset = 0 } = req.query;
  const userId = req.user.id;

  // tag_id 指定時はキーワード不要（TODO 一覧用）
  if (!q && !tag_id) {
    return res.status(400).json({ error: '検索キーワードまたはタグは必須です' });
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
  const parsedOffset = Math.max(parseInt(offset) || 0, 0);
  const keyword = q ? `%${q.trim()}%` : null;

  try {
    // 動的クエリ構築
    let paramIdx = 1;
    const params = [];
    const joins = [];
    const wheres = ['m.is_deleted = false'];

    // ユーザーのルームアクセス制限
    params.push(userId);
    joins.push(`JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $${paramIdx++}`);

    // ルーム指定
    if (room_id) {
      params.push(room_id);
      wheres.push(`m.room_id = $${paramIdx++}`);
    }

    // タグフィルタ
    if (tag_id) {
      params.push(tag_id);
      joins.push(`INNER JOIN message_tags mt ON mt.message_id = m.id AND mt.tag_id = $${paramIdx++}`);

      // 完了状態フィルタ
      if (is_done !== undefined && is_done !== '') {
        params.push(is_done === 'true');
        wheres.push(`mt.is_done = $${paramIdx++}`);
      }
    }

    // キーワード検索
    if (keyword) {
      params.push(keyword);
      const kwIdx = paramIdx++;
      wheres.push(`(
        m.content ILIKE $${kwIdx}
        OR (m.type = 'voice' AND (vt.formatted_text ILIKE $${kwIdx} OR vt.raw_text ILIKE $${kwIdx}))
      )`);
    }

    // ソート
    let orderBy = 'm.created_at DESC';
    if (sort === 'priority' && tag_id) {
      orderBy = 'mt.priority DESC, m.created_at DESC';
    }

    params.push(parsedLimit, parsedOffset);

    const query = `
      SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at, m.is_deleted,
             u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
             r.name AS room_name, r.type AS room_type,
             vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
             ${tag_id ? ', mt.is_done, mt.priority' : ''}
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      JOIN rooms r ON r.id = m.room_id
      ${joins.join('\n      ')}
      LEFT JOIN LATERAL (
        SELECT formatted_text, raw_text FROM voice_transcriptions
        WHERE message_id = m.id ORDER BY version DESC LIMIT 1
      ) vt ON m.type = 'voice'
      WHERE ${wheres.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    const result = await pool.query(query, params);

    // For voice messages, use transcription as display content
    const results = result.rows.map(r => {
      if (r.type === 'voice' && !r.content) {
        r.content = r.transcription_text || r.transcription_raw || null;
      }
      // Get room display name for direct rooms
      if (r.room_type === 'direct') {
        r.room_name = r.sender_display_name;
      }
      return r;
    });

    res.json({ results });
  } catch (err) {
    logger.error('Search error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
