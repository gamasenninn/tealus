import { getIo } from '../io-registry.mts';

/**
 * 同じ人への知らせをまとめる間 (ms)。★ 既読は束で来る (11-01 16:18:49.994〜50.035 の 40ms に 4 本) ので、
 * 1 本ごとに知らせると受けた全端末・全タブが 1 本ごとに一覧を取り直していた (改善ループ 37、既読の束 1 つで 2.4〜5 本)
 */
export const UNREAD_CHANGED_COALESCE_MS = 300;

/** まとめている最中の人 → 最後の部屋 */
const pending = new Map<string, string>();

/**
 * ★ #532 既読を付けたら、同じ人の全端末に知らせる (部屋の一覧の未読数・アプリのバッジを取り直す合図)。
 *   以前は同じ部屋の他の人に既読の数を配るだけで、スマホで読んでも PC の一覧の未読が
 *   次の新着か読み込み直すまで残った。REST の既読・「すべて既読」・socket の既読の 3 か所から呼ぶ。
 * ★ 同じ人への知らせは UNREAD_CHANGED_COALESCE_MS まとめて 1 回にする (送るのは最後の部屋。画面は room_id を使わず取り直すだけ)
 * ★ 知らせられなくても既読そのものは失敗させない
 */
export function announceUnreadChanged(userId: string, roomId: string): void {
  const waiting = pending.has(userId);
  pending.set(userId, roomId);
  if (waiting) return;
  const timer = setTimeout(() => {
    const last = pending.get(userId);
    pending.delete(userId);
    try {
      getIo().to(`user:${userId}`).emit('unread:changed', { room_id: last });
    } catch {
      // socket の準備前 (テストの一部) は知らせない
    }
  }, UNREAD_CHANGED_COALESCE_MS);
  timer.unref?.();
}
