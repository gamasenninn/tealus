/**
 * 投稿が届いたときに通知音を鳴らすか (2026-10-02)。
 * ★ 自分の投稿 (別の端末でも) と system メッセージ (入退室・通話の開始/終了など) は鳴らさない。
 *   system メッセージは中央に小さく出す (SystemMessage) ので、音も控える (利用者判断)
 * ★ 開いている部屋 (useSocketSync) と部屋の一覧 (RoomList) の両方がこれを使う
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
