/**
 * /api/admin 配下のルーターを束ねる入口。
 * 各サブルーター（users, portal-links, webhooks, agent-stats, rooms）は
 * 内部で full path (`/users`, `/portal-links` 等) を書き、ここでは `/` にマウントする。
 * これにより既存エンドポイントパスを変えずに責務別ファイルに分割できる。
 */
const express = require('express');
const { authenticate, requireAdmin } = require('../../middleware/auth');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

router.use('/', require('./users'));
router.use('/', require('./portal-links'));
router.use('/', require('./webhooks'));
router.use('/', require('./agent-stats'));
router.use('/', require('./rooms'));
router.use('/', require('./transcription'));

module.exports = router;
