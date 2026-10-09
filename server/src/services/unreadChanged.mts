import { getIo } from '../io-registry.mts';

/**
 * ★ #532 既読を付けたら、同じ人の全端末に知らせる (部屋の一覧の未読数・アプリのバッジを取り直す合図)。
 *   以前は同じ部屋の他の人に既読の数を配るだけで、スマホで読んでも PC の一覧の未読が
 *   次の新着か読み込み直すまで残った。REST の既読・「すべて既読」・socket の既読の 3 か所から呼ぶ。
 * ★ 知らせられなくても既読そのものは失敗させない
 */
export function announceUnreadChanged(userId: string, roomId: string): void {
  try {
    getIo().to(`user:${userId}`).emit('unread:changed', { room_id: roomId });
  } catch {
    // socket の準備前 (テストの一部) は知らせない
  }
}
