/**
 * /api/admin 配下のルーターを束ねる入口。
 * 各サブルーター（users, portal-links, webhooks, agent-stats, rooms）は
 * 内部で full path (`/users`, `/portal-links` 等) を書き、ここでは `/` にマウントする。
 * これにより既存エンドポイントパスを変えずに責務別ファイルに分割できる。
 */
import express from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth.mts';
import { router as usersRouter } from './users.mts';
import { router as portalLinksRouter } from './portal-links.mts';
import { router as webhooksRouter } from './webhooks.mts';
import { router as agentStatsRouter } from './agent-stats.mts';
import { router as accessLogRouter } from './access-log.mts';
import { router as roomsRouter } from './rooms.mts';
import { router as transcriptionRouter } from './transcription.mts';
import { router as dictionaryRouter } from './dictionary.mts';

export const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

router.use('/', usersRouter);
router.use('/', portalLinksRouter);
router.use('/', webhooksRouter);
router.use('/', agentStatsRouter);
router.use('/', accessLogRouter);
router.use('/', roomsRouter);
router.use('/', transcriptionRouter);
router.use('/', dictionaryRouter);
