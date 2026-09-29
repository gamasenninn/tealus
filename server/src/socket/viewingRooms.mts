/**
 * #475 接続ごとに「いま見ている部屋」を覚える。通知の送り先から外す人を決めるのに使う。
 *
 * ★ 以前は「どの端末からでも接続している人」を送り先から外していたので、
 *   PC を開いたままだとスマホに通知が 1 件も届かなかった (5 日間 0 件の利用者がいた)。
 * ★ 「見ている」= その部屋を開いていて画面が見えている。画面側が room:viewing で知らせる。
 *   更新前の画面は知らせないので、その端末は「見ていない」扱いになる。
 * ★ socket.io に依存しない (送る側の services から引けるように)。
 */

interface SocketView { userId: string; rooms: Set<string> }

const bySocket = new Map<string, SocketView>();

/** 接続 socketId の利用者 userId が、roomId を見ている / 見なくなった */
export function setViewing(socketId: string, userId: string, roomId: string, viewing: boolean): void {
  let v = bySocket.get(socketId);
  if (viewing) {
    if (!v) { v = { userId, rooms: new Set() }; bySocket.set(socketId, v); }
    v.rooms.add(roomId);
  } else if (v) {
    v.rooms.delete(roomId);
    if (v.rooms.size === 0) bySocket.delete(socketId);
  }
}

/** 接続が切れたら、その接続の分を消す */
export function removeSocket(socketId: string): void {
  bySocket.delete(socketId);
}

/** roomId をいま見ている利用者 (重複なし) */
export function viewingUserIds(roomId: string): string[] {
  const users = new Set<string>();
  for (const v of bySocket.values()) if (v.rooms.has(roomId)) users.add(v.userId);
  return [...users];
}

/** テスト用 */
export function clearViewing(): void {
  bySocket.clear();
}
