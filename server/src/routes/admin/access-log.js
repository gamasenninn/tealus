/**
 * GET /api/admin/access-log
 * アクセスログ MVP-0 (#1)。新規テーブルなしで、既存の
 *   - messages (投稿)        → 最終投稿時刻
 *   - room_read_cursors (閲覧) → 最終閲覧時刻 (= 既読カーソル)
 * を集計し、管理ダッシュボードで「誰が・いつ・どのルームを」を可視化する。
 *
 * 制約 (合意済み):
 *   - 閲覧は既読カーソル由来のため「最後に覗いた時刻」のスナップショット (履歴ではない)。
 *   - カーソルは新着を既読にしたときに進むため、純粋な「開いた時刻」とは多少ずれる。
 */
const logger = require('../../utils/logger');
const E = require('../../constants/errors');
const express = require('express');
const pool = require('../../db/pool');

const router = express.Router();

router.get('/access-log', async (req, res) => {
  try {
    // ユーザ別サマリ: users を基点に投稿/閲覧の最終時刻を LEFT JOIN (未活動は null)
    const users = await pool.query(
      `SELECT u.id, u.login_id, u.display_name, u.role, u.is_active, u.is_bot,
              p.last_post_at, v.last_view_at
       FROM users u
       LEFT JOIN (
         SELECT sender_id, MAX(created_at) AS last_post_at
         FROM messages WHERE is_deleted = false
         GROUP BY sender_id
       ) p ON p.sender_id = u.id
       LEFT JOIN (
         SELECT user_id, MAX(last_read_at) AS last_view_at
         FROM room_read_cursors
         GROUP BY user_id
       ) v ON v.user_id = u.id
       ORDER BY GREATEST(
         COALESCE(p.last_post_at, 'epoch'::timestamptz),
         COALESCE(v.last_view_at, 'epoch'::timestamptz)
       ) DESC, u.created_at ASC`
    );

    // (ユーザ×ルーム) マトリクス: 投稿集計と閲覧集計を FULL OUTER JOIN
    // (投稿のみ / 閲覧のみ の組も拾う)。room 名は group=rooms.name、direct=相手の表示名。
    const matrix = await pool.query(
      `SELECT COALESCE(p.user_id, v.user_id) AS user_id,
              COALESCE(p.room_id, v.room_id) AS room_id,
              COALESCE(r.name, partner.display_name, 'DM') AS room_name,
              p.last_post_at, v.last_view_at
       FROM (
         SELECT sender_id AS user_id, room_id, MAX(created_at) AS last_post_at
         FROM messages WHERE is_deleted = false
         GROUP BY sender_id, room_id
       ) p
       FULL OUTER JOIN (
         SELECT user_id, room_id, MAX(last_read_at) AS last_view_at
         FROM room_read_cursors
         GROUP BY user_id, room_id
       ) v ON v.user_id = p.user_id AND v.room_id = p.room_id
       LEFT JOIN rooms r ON r.id = COALESCE(p.room_id, v.room_id)
       LEFT JOIN LATERAL (
         SELECT u2.display_name FROM room_members rm2 JOIN users u2 ON u2.id = rm2.user_id
         WHERE rm2.room_id = r.id AND rm2.user_id != COALESCE(p.user_id, v.user_id) LIMIT 1
       ) partner ON r.type = 'direct'
       ORDER BY GREATEST(
         COALESCE(p.last_post_at, 'epoch'::timestamptz),
         COALESCE(v.last_view_at, 'epoch'::timestamptz)
       ) DESC`
    );

    res.json({ users: users.rows, matrix: matrix.rows });
  } catch (err) {
    logger.error('Admin access-log error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
