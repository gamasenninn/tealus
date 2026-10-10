import express from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.mts';
import { JWT_SECRET } from '../middleware/auth.mts';

/**
 * #525 POST /api/client-errors — 画面 (client) で起きたエラーを本体のログに 1 行残す。
 *
 * ★ 以前は利用者の端末で起きたエラーがどこにも残らなかった (docs/03「画面のエラーの記録」)。
 * ★ 認証不要 — ログイン画面で落ちることもある。トークンが読めれば誰の画面かを添えるだけで、
 *   読めなくても受ける (認証の失敗で記録を落とさない)。
 * ★ 投稿の本文は画面側が送らない約束。ここでは決まった欄だけを、長さを切って 1 行で書く。
 * ★ 送り手 (利用者 / IP) ごとに回数の上限。壊れた画面が送り続けてもログが溢れないように。
 *   本体のメモリに持つ (消えても害が無い。docs/03 の「本体のメモリ」)。
 */
export const router = express.Router();

const KINDS = new Set(['render', 'error', 'unhandledrejection']);
export const CLIENT_ERROR_LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;
const counts = new Map<string, { n: number; from: number }>();

export function resetClientErrorLimits(): void { counts.clear(); }

// 1 行にまとめて長さを切る (改行・制御文字はログを壊すので空白に)
function clip(v: unknown, max: number): string {
  if (typeof v !== 'string' || v === '') return '-';
  // eslint-disable-next-line no-control-regex
  const one = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

function userIdFrom(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET) as { id?: unknown };
    return typeof decoded.id === 'string' ? decoded.id : null;
  } catch {
    return null;
  }
}

/**
 * ★ #563 起きたときの状況。決まった項目だけを、決まった順で 1 行にする (それ以外の欄は捨てる)。
 *   iPhone は別オリジン扱いのエラーを「Script error.」に伏せるので、どのファイルか・表か裏か・何秒後かが手がかりになる
 */
const CTX_KEYS = ['src', 'line', 'col', 'vis', 'sinceLoadSec', 'sinceVisibleSec', 'standalone', 'online'] as const;
function ctxLine(ctx: unknown): string {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return '-';
  const c = ctx as Record<string, unknown>;
  const parts = CTX_KEYS.filter((k) => c[k] !== undefined && ['string', 'number', 'boolean'].includes(typeof c[k]) || c[k] === null)
    .map((k) => `${k}=${clip(String(c[k]), 200)}`);
  return parts.length ? parts.join(' ') : '-';
}

router.post('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.kind !== 'string' || !KINDS.has(body.kind)) {
    res.status(400).json({ error: 'kind が不正です' });
    return;
  }

  const userId = userIdFrom(req.headers.authorization);
  const key = userId ?? `ip:${req.ip}`;
  const now = Date.now();
  const c = counts.get(key);
  if (!c || now - c.from > WINDOW_MS) {
    counts.set(key, { n: 1, from: now });
  } else if (c.n >= CLIENT_ERROR_LIMIT) {
    res.status(429).end();
    return;
  } else {
    c.n++;
  }

  // スタックは先頭の数行 (どこで落ちたか) だけ。画面側が「部品 3 行 + 位置 3 行」で送ってくる
  const stack = typeof body.stack === 'string' ? body.stack.split('\n').slice(0, 6).join(' | ') : '';
  logger.warn(`[client-error] kind=${body.kind} path=${clip(body.path, 120)} build=${clip(body.build, 60)}`
    + ` user=${userId ? userId.slice(0, 8) : '-'} ua=${clip(req.headers['user-agent'], 120)}`
    + ` message=${clip(body.message, 300)} at=${clip(stack, 500)} ctx=${ctxLine(body.ctx)}`);
  res.status(204).end();
});

export default router;
