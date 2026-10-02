/**
 * 投稿が指す別の投稿 (返信先・転送元) を、送り手が指してよいかを確かめる (#482、2026-10-02)
 *
 * ★ 返信先は**投稿する部屋と同じ部屋の投稿**だけ (画面の返信は同じ部屋でしか作れない)
 * ★ 転送元は**送り手がメンバーである部屋の投稿**だけ (画面の転送は自分の部屋から。削除済みでも部屋が分かれば通す = 以前と同じ)
 * ★ 満たさなければ投稿ごと断る (利用者判断)。参照だけ外すと「返信」が単独の発言に変わるため
 * ★★ 無い投稿と、指せない投稿は同じ答えにする (区別して返さない)
 * ★ メディアの転送 (routes/media.mts の /forward) は以前から同じことを確かめている
 */
import { pool } from '../db/pool.mts';
import { isUuid } from '../utils/uuid.mts';

export type RefCheck = { ok: true } | { ok: false; status: 400 | 403; error: string };

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

export async function checkMessageRefs(
  { roomId, userId, replyTo, forwardedFrom }: { roomId: string; userId: string; replyTo?: unknown; forwardedFrom?: unknown },
): Promise<RefCheck> {
  if (present(replyTo)) {
    if (!isUuid(replyTo)) return { ok: false, status: 400, error: '返信先の ID が正しくありません' };
    const r = await pool.query('SELECT 1 FROM messages WHERE id = $1 AND room_id = $2', [replyTo, roomId]);
    if (r.rows.length === 0) return { ok: false, status: 403, error: '返信先のメッセージにアクセスできません' };
  }
  if (present(forwardedFrom)) {
    if (!isUuid(forwardedFrom)) return { ok: false, status: 400, error: '転送元の ID が正しくありません' };
    const r = await pool.query(
      `SELECT 1 FROM messages m JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $2 WHERE m.id = $1`,
      [forwardedFrom, userId],
    );
    if (r.rows.length === 0) return { ok: false, status: 403, error: '転送元のメッセージにアクセスできません' };
  }
  return { ok: true };
}
