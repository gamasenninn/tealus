const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const { SALT_ROUNDS } = require('../constants/config');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, employee_id, display_name, avatar_url, status_message, role, is_active, is_bot, last_seen_at, created_at, updated_at FROM users ORDER BY created_at'
    );
    res.json({ users: result.rows });
  } catch (err) {
    logger.error('Admin list users error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/users
 * Create a new user
 */
router.post('/users', async (req, res) => {
  const { employee_id, display_name, password, role = 'user', is_bot = false } = req.body;

  if (!employee_id || !display_name || !password) {
    return res.status(400).json({ error: '社員番号、表示名、パスワードは必須です' });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE employee_id = $1',
      [employee_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'この社員番号は既に登録されています' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (employee_id, display_name, password_hash, role, is_bot)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_bot, is_active, created_at`,
      [employee_id, display_name, password_hash, role, is_bot]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Admin create user error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update user (display_name, password, role)
 */
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { display_name, password, role, is_bot } = req.body;

  try {
    // Check user exists
    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(display_name);
    }
    if (password !== undefined) {
      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(password_hash);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    if (is_bot !== undefined) {
      updates.push(`is_bot = $${paramIndex++}`);
      values.push(is_bot);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    updates.push(`updated_at = now()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
      values
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Admin update user error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 * Activate/deactivate user
 */
router.patch('/users/:id/status', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (is_active === undefined) {
    return res.status(400).json({ error: 'is_active は必須です' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Admin update status error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// ============================================
// ポータルリンク管理
// ============================================

/**
 * GET /api/admin/portal-links
 */
router.get('/portal-links', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM portal_links ORDER BY sort_order, created_at');
    res.json({ links: result.rows });
  } catch (err) {
    logger.error('Admin list portal links error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/portal-links
 */
router.post('/portal-links', async (req, res) => {
  const { title, url, icon } = req.body;
  if (!title || !url) {
    return res.status(400).json({ error: 'タイトルとURLは必須です' });
  }
  try {
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM portal_links');
    const result = await pool.query(
      `INSERT INTO portal_links (title, url, icon, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, url, icon || null, maxOrder.rows[0].next, req.user.id]
    );
    res.status(201).json({ link: result.rows[0] });
  } catch (err) {
    logger.error('Admin create portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/admin/portal-links/:id
 */
router.put('/portal-links/:id', async (req, res) => {
  const { id } = req.params;
  const { title, url, icon, sort_order, is_active } = req.body;
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;
    if (title !== undefined) { updates.push(`title = $${paramIndex++}`); values.push(title); }
    if (url !== undefined) { updates.push(`url = $${paramIndex++}`); values.push(url); }
    if (icon !== undefined) { updates.push(`icon = $${paramIndex++}`); values.push(icon); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${paramIndex++}`); values.push(sort_order); }
    if (is_active !== undefined) { updates.push(`is_active = $${paramIndex++}`); values.push(is_active); }
    if (updates.length === 0) return res.status(400).json({ error: '更新する項目がありません' });
    values.push(id);
    const result = await pool.query(
      `UPDATE portal_links SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'リンクが見つかりません' });
    res.json({ link: result.rows[0] });
  } catch (err) {
    logger.error('Admin update portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/admin/portal-links/:id
 */
router.delete('/portal-links/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM portal_links WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'リンクが見つかりません' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin delete portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// ============================================
// Webhook管理
// ============================================

/**
 * GET /api/admin/webhooks
 * Webhook一覧取得
 */
router.get('/webhooks', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.room_id, r.name as room_name, r.type as room_type, w.url, w.events, w.is_active, w.created_at,
              (SELECT string_agg(u.display_name, ' ↔ ')
               FROM room_members rm JOIN users u ON u.id = rm.user_id
               WHERE rm.room_id = r.id) AS dm_member_names
       FROM webhooks w
       LEFT JOIN rooms r ON r.id = w.room_id
       ORDER BY w.created_at DESC`
    );
    // DM ルームの場合、room_name をメンバー名で補完
    const webhooks = result.rows.map(w => ({
      ...w,
      room_name: w.room_name || (w.room_type === 'direct' ? w.dm_member_names : null),
      dm_member_names: undefined,
      room_type: undefined,
    }));
    res.json({ webhooks });
  } catch (err) {
    logger.error('Admin list webhooks error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/webhooks
 * Webhook登録
 */
router.post('/webhooks', async (req, res) => {
  const { url, room_id, secret, events = ['message.created'] } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URLは必須です' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO webhooks (url, room_id, secret, events, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, room_id, url, events, is_active, created_at`,
      [url, room_id || null, secret || null, events, req.user.id]
    );

    res.status(201).json({ webhook: result.rows[0] });
  } catch (err) {
    logger.error('Admin create webhook error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/admin/webhooks/:id
 * Webhook更新
 */
router.put('/webhooks/:id', async (req, res) => {
  const { id } = req.params;
  const { url, room_id, secret, events, is_active } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (url !== undefined) { updates.push(`url = $${paramIndex++}`); values.push(url); }
    if (room_id !== undefined) { updates.push(`room_id = $${paramIndex++}`); values.push(room_id || null); }
    if (secret !== undefined) { updates.push(`secret = $${paramIndex++}`); values.push(secret); }
    if (events !== undefined) { updates.push(`events = $${paramIndex++}`); values.push(events); }
    if (is_active !== undefined) { updates.push(`is_active = $${paramIndex++}`); values.push(is_active); }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, room_id, url, events, is_active, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhookが見つかりません' });
    }

    res.json({ webhook: result.rows[0] });
  } catch (err) {
    logger.error('Admin update webhook error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/admin/webhooks/:id
 * Webhook削除
 */
router.delete('/webhooks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM webhooks WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhookが見つかりません' });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin delete webhook error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/webhooks/:id/test
 * テスト送信
 */
router.post('/webhooks/:id/test', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM webhooks WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhookが見つかりません' });
    }

    const webhook = result.rows[0];
    const payload = JSON.stringify({
      event: 'test',
      timestamp: new Date().toISOString(),
      message: { content: 'Tealus Webhook テスト送信' },
    });

    const { dispatchWebhook } = require('../services/webhook');
    const testResult = await dispatchWebhook(webhook, payload);

    res.json({ success: testResult.ok, status: testResult.status });
  } catch (err) {
    logger.error('Admin test webhook error:', err);
    res.status(502).json({ error: 'テスト送信に失敗しました', details: err.message });
  }
});

// === エージェントモニタリング API ===

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

/**
 * GET /api/admin/rooms
 * List all rooms (admin only) — エージェントのルーム名解決用
 */
router.get('/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.type, r.name, r.created_at,
             (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS member_count
      FROM rooms r
      ORDER BY r.created_at
    `);

    // DM ルームのメンバー名を取得
    const rooms = [];
    for (const r of result.rows) {
      const room = { ...r };
      if (r.type === 'direct') {
        const members = await pool.query(
          `SELECT u.id, u.display_name FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = $1`,
          [r.id]
        );
        room.members = members.rows;
      }
      rooms.push(room);
    }

    res.json({ rooms });
  } catch (err) {
    logger.error('Admin list rooms error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
