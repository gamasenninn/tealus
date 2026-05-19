const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { canSearchUsers } = require('../utils/permissions');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/users
 * List all active users (excluding current user)
 */
router.get('/', async (req, res) => {
  if (!canSearchUsers(req.user)) {
    return res.status(403).json({ error: 'ゲストユーザは他のユーザー情報を参照できません' });
  }
  try {
    const result = await pool.query(
      `SELECT id, login_id, display_name, avatar_url, status_message
       FROM users
       WHERE is_active = true AND id != $1
       ORDER BY display_name`,
      [req.user.id]
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
router.get('/online', (req, res) => {
  if (!canSearchUsers(req.user)) {
    return res.status(403).json({ error: 'ゲストユーザは他のユーザー情報を参照できません' });
  }
  const { getOnlineUserIds } = require('../socket');
  res.json({ online: getOnlineUserIds() });
});

module.exports = router;
