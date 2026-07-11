import { getOnlineUserIds } from '../socket/index.mts';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { canSearchUsers } from '../utils/permissions.mts';

export const router = express.Router();

router.use(authenticate);

/** ユーザー一覧 1 行 */
interface UserListRow {
  id: string;
  login_id: string;
  display_name: string;
  avatar_url: string | null;
  status_message: string | null;
}

/**
 * GET /api/users
 * List all active users (excluding current user)
 */
router.get('/', async (req, res) => {
  if (!canSearchUsers(req.user)) {
    return res.status(403).json({ error: 'ゲストユーザは他のユーザー情報を参照できません' });
  }
  try {
    const result = await pool.query<UserListRow>(
      `SELECT id, login_id, display_name, avatar_url, status_message
       FROM users
       WHERE is_active = true AND id != $1
       ORDER BY display_name`,
      [req.user!.id]
    );
    res.json({ users: result.rows });
  } catch (err) {
    logger.error('List users error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/users/online
 * Get list of online user IDs
 */
router.get('/online', async (req, res) => {
  if (!canSearchUsers(req.user)) {
    return res.status(403).json({ error: 'ゲストユーザは他のユーザー情報を参照できません' });
  }
  
  res.json({ online: getOnlineUserIds() });
});
