/**
 * 「ここから未読」の線を出す投稿を決める (部屋一覧の未読と同じ数え方: 自分以外・削除されていない便)。
 *
 * ★ 以前は既読の次の 1 便だけを見て、それが自分の便なら線を出さなかった。一覧には「未読 3」と出るのに、
 *   開くと線が無かった (2026-10-30 改善ループ 26 回目、本番で 53 組中 3 組)
 */
export function findUnreadStartId(
  messages: { id: string; sender_id: string | null; is_deleted?: boolean }[],
  lastReadMessageId: string | null,
  myId: string,
): string | null {
  if (!lastReadMessageId) return null;
  const i = messages.findIndex((m) => m.id === lastReadMessageId);
  if (i < 0) return null;
  const next = messages.slice(i + 1).find((m) => m.sender_id !== myId && !m.is_deleted);
  return next ? next.id : null;
}
