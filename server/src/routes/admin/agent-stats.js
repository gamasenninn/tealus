const logger = require('../../utils/logger');
const E = require('../../constants/errors');
const express = require('express');
const pool = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/admin/agent-stats
 * エージェント稼働統計
 */
router.get('/agent-stats', async (req, res) => {
  try {
    // Bot ユーザーの ID 取得
    const bots = await pool.query('SELECT id FROM users WHERE is_bot = true');
    const botIds = bots.rows.map(b => b.id);
    if (botIds.length === 0) return res.json({ contexts: [], stats: {}, room_stats: [] });

    // agent_contexts（ルーム名付き）
    const ctxResult = await pool.query(
      `SELECT ac.*, u.display_name AS agent_name,
              r.name AS room_name, r.type AS room_type,
              partner.display_name AS partner_display_name
       FROM agent_contexts ac
       JOIN users u ON u.id = ac.agent_id
       LEFT JOIN rooms r ON r.id = ac.room_id
       LEFT JOIN LATERAL (
         SELECT u2.display_name FROM room_members rm2 JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != ac.agent_id LIMIT 1
       ) partner ON r.type = 'direct'
       ORDER BY ac.last_interaction_at DESC`
    );

    // 応答回数（全体、今日、今週）
    const statsResult = await pool.query(
      `SELECT
        COUNT(*)::int AS total_responses,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_responses,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE))::int AS week_responses
       FROM messages WHERE sender_id = ANY($1) AND is_deleted = false`,
      [botIds]
    );

    // 平均応答時間（直近100件: ユーザーメッセージ→次のBot応答の時間差）
    const avgResult = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (bot_msg.created_at - user_msg.created_at)) * 1000)::int AS avg_response_time_ms
       FROM (
         SELECT id, room_id, created_at,
                LEAD(id) OVER (PARTITION BY room_id ORDER BY created_at) AS next_id
         FROM messages WHERE room_id IN (SELECT room_id FROM agent_contexts) AND is_deleted = false
         ORDER BY created_at DESC LIMIT 500
       ) user_msg
       JOIN messages bot_msg ON bot_msg.id = user_msg.next_id
       WHERE user_msg.id IS NOT NULL
         AND bot_msg.sender_id = ANY($1)
         AND user_msg.next_id IS NOT NULL`,
      [botIds]
    );

    // ルーム別応答回数
    const roomResult = await pool.query(
      `SELECT m.room_id,
              COALESCE(r.name, partner.display_name, 'DM') AS room_name,
              COUNT(*)::int AS count,
              MAX(m.created_at) AS last_at
       FROM messages m
       LEFT JOIN rooms r ON r.id = m.room_id
       LEFT JOIN LATERAL (
         SELECT u2.display_name FROM room_members rm2 JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != m.sender_id LIMIT 1
       ) partner ON r.type = 'direct'
       WHERE m.sender_id = ANY($1) AND m.is_deleted = false
       GROUP BY m.room_id, r.name, r.type, partner.display_name
       ORDER BY count DESC`,
      [botIds]
    );

    res.json({
      contexts: ctxResult.rows,
      stats: {
        ...statsResult.rows[0],
        avg_response_time_ms: avgResult.rows[0]?.avg_response_time_ms || 0,
      },
      room_stats: roomResult.rows,
    });
  } catch (err) {
    logger.error('Admin agent-stats error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/admin/agent-logs?offset=0&limit=20&room_id=optional
 * エージェント応答ログ
 */
router.get('/agent-logs', async (req, res) => {
  const { offset = 0, limit = 20, room_id } = req.query;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offsetNum = parseInt(offset) || 0;

  try {
    const botIds = (await pool.query('SELECT id FROM users WHERE is_bot = true')).rows.map(b => b.id);
    if (botIds.length === 0) return res.json({ messages: [], total: 0 });

    const conditions = ['m.sender_id = ANY($1)', 'm.is_deleted = false'];
    const params = [botIds];
    let paramIdx = 2;

    if (room_id) {
      conditions.push(`m.room_id = $${paramIdx++}`);
      params.push(room_id);
    }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM messages m WHERE ${where}`, params
    );

    const msgResult = await pool.query(
      `SELECT m.id, m.room_id, m.content, m.type, m.created_at,
              COALESCE(r.name, partner.display_name, 'DM') AS room_name
       FROM messages m
       LEFT JOIN rooms r ON r.id = m.room_id
       LEFT JOIN LATERAL (
         SELECT u2.display_name FROM room_members rm2 JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != m.sender_id LIMIT 1
       ) partner ON r.type = 'direct'
       WHERE ${where}
       ORDER BY m.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limitNum, offsetNum]
    );

    res.json({ messages: msgResult.rows, total: countResult.rows[0].total });
  } catch (err) {
    logger.error('Admin agent-logs error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/admin/agent-logs/:id/context
 * Bot 応答の前後コンテキスト（直前のユーザー質問）
 */
router.get('/agent-logs/:id/context', async (req, res) => {
  const { id } = req.params;

  try {
    // Bot の応答メッセージを取得
    const botMsg = await pool.query(
      `SELECT m.*, COALESCE(r.name, partner.display_name, 'DM') AS room_name
       FROM messages m
       LEFT JOIN rooms r ON r.id = m.room_id
       LEFT JOIN LATERAL (
         SELECT u2.display_name FROM room_members rm2 JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != m.sender_id LIMIT 1
       ) partner ON r.type = 'direct'
       WHERE m.id = $1`,
      [id]
    );
    if (botMsg.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const bot = botMsg.rows[0];

    // 直前のユーザーメッセージ（同一ルーム、Bot以外、Bot応答より前）
    const userMsg = await pool.query(
      `SELECT m.*, u.display_name AS sender_display_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = $1
         AND m.created_at < $2
         AND m.sender_id NOT IN (SELECT id FROM users WHERE is_bot = true)
         AND m.is_deleted = false
       ORDER BY m.created_at DESC
       LIMIT 1`,
      [bot.room_id, bot.created_at]
    );

    const question = userMsg.rows[0] || null;

    // 音声メッセージの場合、文字起こしテキストを付加
    if (question && question.type === 'voice') {
      const trans = await pool.query(
        'SELECT formatted_text, raw_text FROM voice_transcriptions WHERE message_id = $1 ORDER BY version DESC LIMIT 1',
        [question.id]
      );
      if (trans.rows.length > 0) {
        question.content = trans.rows[0].formatted_text || trans.rows[0].raw_text || question.content;
      }
    }

    res.json({
      response: bot,
      question,
    });
  } catch (err) {
    logger.error('Admin agent-log context error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
