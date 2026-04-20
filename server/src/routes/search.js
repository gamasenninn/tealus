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
  const { q, room_id, tag_id, tag_names, is_done, sort, limit = 50, offset = 0 } = req.query;
  const userId = req.user.id;
  const tagNameList = tag_names ? tag_names.split(',').map(s => s.trim()).filter(Boolean) : [];

  // tag_id/tag_names 指定時はキーワード不要
  if (!q && !tag_id && tagNameList.length === 0) {
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
    const hasTagFilter = !!(tag_id || tagNameList.length > 0);

    if (tag_id) {
      // 単一タグ: tag_id ベース（ルーム内検索）
      params.push(tag_id);
      joins.push(`INNER JOIN message_tags mt ON mt.message_id = m.id AND mt.tag_id = $${paramIdx++}`);
      joins.push(`INNER JOIN tags t_filter ON t_filter.id = mt.tag_id`);
    } else if (tagNameList.length > 0) {
      // tag_names ベース: サブクエリで AND 検索
      const placeholders = tagNameList.map(name => {
        params.push(name);
        return `$${paramIdx++}`;
      });
      params.push(tagNameList.length);
      wheres.push(`m.id IN (
        SELECT mt_sub.message_id FROM message_tags mt_sub
        JOIN tags t_sub ON t_sub.id = mt_sub.tag_id
        WHERE t_sub.name IN (${placeholders.join(',')})
        GROUP BY mt_sub.message_id
        HAVING COUNT(DISTINCT t_sub.name) = $${paramIdx++}
      )`);
      // 最初の TODO タグの is_done/priority を取得するために JOIN
      params.push(tagNameList[0]);
      joins.push(`INNER JOIN message_tags mt ON mt.message_id = m.id`);
      joins.push(`INNER JOIN tags t_filter ON t_filter.id = mt.tag_id AND t_filter.name = $${paramIdx++}`);
    }

    if (hasTagFilter) {
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
    if (sort === 'priority' && hasTagFilter) {
      orderBy = 'mt.priority DESC, m.created_at DESC';
    }

    params.push(parsedLimit, parsedOffset);


    const query = `
      SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at, m.is_deleted,
             u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
             r.name AS room_name, r.type AS room_type,
             vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
             ${hasTagFilter ? ', mt.is_done, mt.priority, t_filter.id AS tag_id, t_filter.name AS tag_name' : ''}
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
    logger.debug(`search: q=${q || ''} room=${room_id || 'all'} tags=${tag_names || tag_id || ''} results=${result.rows.length}`);

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
