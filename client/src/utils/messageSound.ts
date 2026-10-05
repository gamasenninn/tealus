/**
 * 投稿が届いたときに通知音を鳴らすか (2026-10-02)。
 * ★ 自分の投稿 (別の端末でも) と system メッセージ (入退室・通話の開始/終了など) は鳴らさない。
 *   system メッセージは中央に小さく出す (SystemMessage) ので、音も控える (利用者判断)
 * ★ 使うのは部屋の一覧 (RoomList) だけ。開いている部屋の新着も一覧が鳴らす
 *   (#505 以前は開いている部屋 useSocketSync でも鳴らしていて、1 件で 2 回鳴っていた)
 * @param setting localStorage の notificationSound ('off' で切っている)
 */
export function shouldPlayMessageSound(
  msg: { sender_id?: string; type?: string },
  myId: string | undefined,
  setting: string | null,
): boolean {
  if (setting === 'off') return false;
  if (msg.sender_id === myId) return false;
  if (msg.type === 'system') return false;
  return true;
}
