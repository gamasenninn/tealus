import { logger } from '../../utils/logger.mts';
import * as E from '../../constants/errors.mts';
import express from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../../db/pool.mts';
import { getIo } from '../../io-registry.mts';
import { refreshSocketUser } from '../../socket/index.mts';
import { announceUserUpdated } from '../../services/userUpdated.mts';

import { SALT_ROUNDS } from '../../constants/config.mts';
import { checkDisplayName, loginIdTooLong, passwordTooShort } from '../../utils/userFields.mts';

export const router = express.Router();

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, login_id, display_name, avatar_url, status_message, role, is_active, is_bot, last_seen_at, created_at, updated_at FROM users ORDER BY created_at'
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
  const { password, role = 'user', is_bot = false } = req.body;
  // ★ #584 前後の空白 (全角含む) を落として作る。ログインは落として照合する (#568) ので、空白つきの ID は入れなくなる
  const login_id = typeof req.body.login_id === 'string' ? req.body.login_id.trim() : req.body.login_id;

  if (!login_id || !req.body.display_name || !password) {
    return res.status(400).json({ error: E.AUTH_REGISTER_REQUIRED });
  }
  const name = checkDisplayName(req.body.display_name);
  if ('error' in name) return res.status(400).json({ error: name.error });
  const display_name = name.value;
  const idError = loginIdTooLong(String(login_id));
  if (idError) return res.status(400).json({ error: idError });
  const pwError = passwordTooShort(password);
  if (pwError) return res.status(400).json({ error: pwError });

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE login_id = $1',
      [login_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: E.AUTH_DUPLICATE_LOGIN_ID });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      // ★ 管理者が決めたパスワードのまま使い続けない: 人の利用者には次のログインで変更を求める (042、2026-10-29)。機械には立てない
      `INSERT INTO users (login_id, display_name, password_hash, role, is_bot, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, login_id, display_name, avatar_url, status_message, role, is_bot, is_active, must_change_password, created_at`,
      [login_id, display_name, password_hash, role, is_bot, !is_bot]
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
    const existing = await pool.query<{ id: string; role: string; is_bot: boolean }>('SELECT id, role, is_bot FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      const name = checkDisplayName(display_name);
      if ('error' in name) return res.status(400).json({ error: name.error });
      updates.push(`display_name = $${paramIndex++}`);
      values.push(name.value);
    }
    if (password !== undefined) {
      const pwError = passwordTooShort(password);
      if (pwError) return res.status(400).json({ error: pwError });
      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(password_hash);
      // ★ 管理者が入れ直したパスワードも、本人に変えてもらう (機械と、管理者が自分のを入れ直したときは除く、042)
      updates.push(`must_change_password = $${paramIndex++}`);
      values.push(!(is_bot ?? existing.rows[0].is_bot) && id !== req.user!.id);
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
       RETURNING id, login_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
      values
    );

    // ★ #529 役割を変えたら接続を切る。管理者は接続時に全部屋へ入るので、切らないと一般に戻した後も
    //   全部屋の配信を受け続けた。つなぎ直すと新しい役割で入り直す (昇格も同じ理由で切る)
    if (result.rows[0].role !== existing.rows[0].role) getIo().in(`user:${id}`).disconnectSockets(true);

    // ★ 名前を変えたら、本人が変えたとき (#498・#534) と同じく、つながっている socket の名前を書き換えて部屋に知らせる。
    //   以前は本人の道だけで、管理者が直した名前は、本人がつなぎ直すまで古い名前で配られた (改善ループ 30)
    if (display_name !== undefined) {
      try {
        refreshSocketUser(getIo(), id, { display_name: result.rows[0].display_name });
      } catch (err) {
        logger.warn(`[admin] socket の利用者情報を書き換えられませんでした: ${err instanceof Error ? err.message : String(err)}`);
      }
      await announceUserUpdated(result.rows[0]);
    }

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
       RETURNING id, login_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    // ★ 停止したら接続中の端末も切る (接続時にしか is_active を見ていないので、切らないと配信が届き続ける)
    if (!result.rows[0].is_active) getIo().in(`user:${id}`).disconnectSockets(true);

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Admin update status error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
