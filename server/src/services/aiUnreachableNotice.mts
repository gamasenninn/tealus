import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import { getIo } from '../io-registry.mts';
import { insertSystemMessage } from './systemMessage.mts';

/**
 * AI に届かなかった便に、部屋へ 1 行返す (2026-10-30 小野さん判断 C)。
 *
 * ★ webhook (AI のサーバーへの知らせ) が送り直しても届かなかったとき、以前は記録 1 行だけで、
 *   投稿した人は返事を待ち続けた。AI に宛てた便 (下の 3 つ) のときだけ知らせる:
 *   1. 行頭が `@<部屋にいる機械の名前>` (例 @アシスタント)
 *   2. 行頭が `@cc-` (Claude Code のセッションを起こす便。同じ道で届く)
 *   3. 相手が機械の 1 対 1
 * ★ 障害の間に同じ部屋へ何度も出さない (部屋ごとに 10 分に 1 回)
 */
const NOTICE = '⚠️ AI に届きませんでした (AI のサーバーにつながりません)。少し待ってから、もう一度送ってください';
const QUIET_MS = 10 * 60_000;
const lastNoticeAt = new Map<string, number>();

interface CreatedPayload {
  message?: { content?: string | null; sender?: { id?: string } };
}

/** AI に宛てた便か。宛てていれば知らせの送り主にする機械の ID を返す */
export async function addressedBot(roomId: string, payload: CreatedPayload): Promise<string | null> {
  const senderId = payload.message?.sender?.id;
  const { rows } = await pool.query<{ id: string; display_name: string; room_type: string; members: number }>(
    `SELECT u.id, u.display_name, r.type AS room_type,
            (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS members
       FROM room_members rm JOIN users u ON u.id = rm.user_id JOIN rooms r ON r.id = rm.room_id
      WHERE rm.room_id = $1 AND u.is_bot = true AND u.is_active = true AND u.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')`,
    [roomId, senderId ?? null]
  );
  if (rows.length === 0) return null;
  const head = (payload.message?.content ?? '').trimStart();
  const named = rows.find((b) => head.startsWith(`@${b.display_name}`));
  if (named) return named.id;
  if (head.startsWith('@cc-')) return rows[0].id;
  if (rows[0].room_type === 'direct' && rows[0].members === 2) return rows[0].id;
  return null;
}

export async function noticeAiUnreachable(eventType: string, roomId: string | null, payload: CreatedPayload, now = Date.now()): Promise<boolean> {
  if (eventType !== 'message.created' || !roomId) return false;
  try {
    if (now - (lastNoticeAt.get(roomId) ?? 0) < QUIET_MS) return false;
    const botId = await addressedBot(roomId, payload);
    if (!botId) return false;
    lastNoticeAt.set(roomId, now);
    let io;
    try { io = getIo(); } catch { io = undefined; }
    await insertSystemMessage(roomId, NOTICE, io, botId);
    return true;
  } catch (err) {
    logger.error('[ai-unreachable] 知らせを出せませんでした:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** テスト用 */
export function _resetAiUnreachableNotice(): void { lastNoticeAt.clear(); }
