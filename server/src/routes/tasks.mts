/**
 * タスク一覧 (docs/16、#661)。
 *   本人の口  /api/tasks       — 自分の一覧を読む・足す・直す・消す
 *   AI の口   /api/bot/tasks   — 頼んだ人 (X-Tealus-Requester) の一覧を読む・足す・直す。★ 済みにしない・消さない (§4.3)
 * 中身は services/taskRepo.mts。テスト: __tests__/integration/tasks.test.mts
 */
import express, { type Request, type Response } from 'express';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import { authenticate } from '../middleware/auth.mts';
import { readRequester, requesterOf } from '../services/requesterScope.mts';
import { listTasks, createTask, updateTask, deleteTask, TaskInputError } from '../services/taskRepo.mts';
import { isGuest } from '../utils/permissions.mts';
import { pool } from '../db/pool.mts';

/**
 * ★ お客様 (guest) は使えない (11-27 ブラウザの試験で、お客様の口座でも呼べた)。段階 1 は社員本人の一覧だけ (docs/16 §4.1・§7)。
 *   画面はお客様にボタンを出していないが、口が開いていると一覧を作れてしまう
 */
const GUEST_REFUSED = 'お客様の口座ではタスクを使えません';

function fail(res: Response, err: unknown, where: string): Response {
  if (err instanceof TaskInputError) return res.status(err.status).json({ error: err.message });
  logger.error(`[tasks] ${where} error:`, err);
  return res.status(500).json({ error: E.SERVER_ERROR });
}

const q = (v: unknown) => (typeof v === 'string' ? v : undefined);

// ============================================
// 本人の口
// ============================================
export const router = express.Router();
router.use(authenticate);
router.use((req: Request, res: Response, next) => {
  if (isGuest(req.user)) return res.status(403).json({ error: GUEST_REFUSED });
  next();
});

router.get('/', async (req, res) => {
  try {
    res.json({ tasks: await listTasks(req.user!.id, { status: q(req.query.status), roomId: q(req.query.room_id) }) });
  } catch (err) { fail(res, err, 'list'); }
});

router.post('/', async (req, res) => {
  try {
    res.status(201).json({ task: await createTask(req.user!.id, req.user!.id, req.body ?? {}) });
  } catch (err) { fail(res, err, 'create'); }
});

router.patch('/:taskId', async (req, res) => {
  try {
    const task = await updateTask(req.params.taskId, req.user!.id, req.user!.id, req.body ?? {});
    if (!task) return res.status(404).json({ error: 'タスクが見つかりません' });
    res.json({ task });
  } catch (err) { fail(res, err, 'update'); }
});

router.delete('/:taskId', async (req, res) => {
  try {
    if (!(await deleteTask(req.params.taskId, req.user!.id))) return res.status(404).json({ error: 'タスクが見つかりません' });
    res.json({ success: true });   // ★ 204 (本文なし) は画面の api.request が読めない
  } catch (err) { fail(res, err, 'delete'); }
});

// ============================================
// AI の口 (誰の一覧かは頼んだ人で決める)
// ============================================
export const botRouter = express.Router();
botRouter.use(authenticate);
botRouter.use(readRequester);
/**
 * ★ 機械の口座だけ。印 (X-Tealus-Requester) は自己申告なので、人の口座が付けると他人の一覧に書けてしまう
 * ★ 印が無ければ断る (誰の一覧に書くかが決まらない。bot の他の口と違い「印が無ければ今までどおり」にしない)
 */
botRouter.use((req: Request, res: Response, next) => {
  if (!req.user?.is_bot) return res.status(403).json({ error: 'この口は機械の口座だけが使えます' });
  if (!requesterOf(res)) return res.status(400).json({ error: '誰のタスクか (X-Tealus-Requester) が要ります' });
  next();
});
// ★ 頼んだ人がお客様なら断る (お客様の一覧に AI が書かない)。印の人が居ないときは今までどおり (taskRepo が部屋・投稿で絞る)
botRouter.use(async (_req: Request, res: Response, next) => {
  try {
    const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [requesterOf(res)]);
    if (rows[0] && isGuest(rows[0])) return res.status(403).json({ error: GUEST_REFUSED });
    next();
  } catch (err) { fail(res, err, 'bot requester'); }
});

botRouter.get('/', async (req, res) => {
  try {
    res.json({ tasks: await listTasks(requesterOf(res)!, { status: q(req.query.status), roomId: q(req.query.room_id) }) });
  } catch (err) { fail(res, err, 'bot list'); }
});

botRouter.post('/', async (req, res) => {
  try {
    const { status: _ignored, ai_suggests_done: _ai, ...input } = (req.body ?? {}) as Record<string, unknown>;   // 足すときは open から
    res.status(201).json({ task: await createTask(requesterOf(res)!, req.user!.id, input) });
  } catch (err) { fail(res, err, 'bot create'); }
});

botRouter.patch('/:taskId', async (req, res) => {
  try {
    if ((req.body ?? {}).status !== undefined) {
      return res.status(400).json({ error: 'AI は状態を変えられません。済んだと思ったら ai_suggests_done: true を付けてください (済みにするのは本人)' });
    }
    const task = await updateTask(req.params.taskId, requesterOf(res)!, req.user!.id, req.body ?? {});
    if (!task) return res.status(404).json({ error: 'タスクが見つかりません' });
    res.json({ task });
  } catch (err) { fail(res, err, 'bot update'); }
});
