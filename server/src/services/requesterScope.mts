/**
 * #564 AI が読める部屋を「頼んだ人が入っている部屋」に絞る。
 *
 * ★ AI の道具 (tealus-mcp) は bot の資格で本体を呼ぶので、本体からは誰の依頼かが見えなかった。
 *   agent-server の中継が `X-Tealus-Requester: <依頼した人の ID>` を付け、bot の読み取りの口をその人が入っている部屋に絞る。
 * ★ ヘッダが無ければ今までどおり (cc ブリッジ・LINE などの bot)。
 * ★★ この印は**絞る方向にしか効かない**: どの口も「bot が入っている部屋」で既に絞っていて、その上に重ねるだけ。
 *   bot が自分で付けても、自分が読める範囲より広くはならない (= 認証の代わりではない)
 * 設計: docs/03「AI が読める部屋は『頼んだ人が入っている部屋』だけ」
 */
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.mts';
import { isUuid } from '../utils/uuid.mts';

export const REQUESTER_HEADER = 'x-tealus-requester';
const DENIED = '依頼した人がこのルームのメンバーではありません';

/** ヘッダを読んで res.locals.requesterId に置く。形が崩れていれば 400 (黙って絞らずに通さない) */
export function readRequester(req: Request, res: Response, next: NextFunction): Response | void {
  const v = req.get(REQUESTER_HEADER);
  if (v === undefined) return next();
  if (!isUuid(v)) return res.status(400).json({ error: `${REQUESTER_HEADER} が ID の形ではありません` });
  res.locals.requesterId = v;
  next();
}

export function requesterOf(res: Response): string | null {
  return typeof res.locals.requesterId === 'string' ? res.locals.requesterId : null;
}

async function requesterIn(roomId: string, requesterId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, requesterId]);
  return rows.length > 0;
}

/** room_id (query) / :id (部屋) の口の前に置く。依頼した人が入っていなければ 403 */
export function scopeByRoom(from: 'query' | 'param') {
  return async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const requesterId = requesterOf(res);
    const roomId = String(from === 'query' ? req.query.room_id ?? '' : req.params.id ?? '');
    if (!requesterId || !roomId || !isUuid(roomId)) return next();   // 部屋の指定が無い・形が違うのは各口に任せる
    if (!(await requesterIn(roomId, requesterId))) return res.status(403).json({ error: DENIED });
    next();
  };
}

/** :id (投稿) の口の前に置く。投稿の部屋に依頼した人が入っていなければ 403 */
export async function scopeByMessage(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const requesterId = requesterOf(res);
  const messageId = String(req.params.id ?? '');
  if (!requesterId || !isUuid(messageId)) return next();
  const { rows } = await pool.query<{ room_id: string }>('SELECT room_id FROM messages WHERE id = $1', [messageId]);
  if (!rows.length) return next();   // 無い投稿は各口の 404 に任せる
  if (!(await requesterIn(rows[0].room_id, requesterId))) return res.status(403).json({ error: DENIED });
  next();
}

/** 一覧の口の SQL に足す条件。roomCol の部屋に依頼した人が入っていること ($n は呼び出し側で push) */
export function requesterRoomCondition(roomCol: string, paramIdx: number): string {
  return `EXISTS (SELECT 1 FROM room_members rq WHERE rq.room_id = ${roomCol} AND rq.user_id = $${paramIdx})`;
}
