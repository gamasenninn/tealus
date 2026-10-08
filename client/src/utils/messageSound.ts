/**
 * 投稿が届いたときに通知音を鳴らすか (2026-10-02)。
 * ★ 自分の投稿 (別の端末でも) と system メッセージ (入退室・通話の開始/終了など) は鳴らさない。
 *   system メッセージは中央に小さく出す (SystemMessage) ので、音も控える (利用者判断)
 * ★ 使うのは部屋の一覧 (RoomList) だけ。開いている部屋の新着も一覧が鳴らす
 *   (#505 以前は開いている部屋 useSocketSync でも鳴らしていて、1 件で 2 回鳴っていた)
 * ★ 2026-10-08: 「このルームの通知」を切った部屋も鳴らさない。それまではプッシュにしか効かず、
 *   開いている間は鳴って「切ったのに鳴る」と言われた
 * @param prefs.soundOn アカウントの通知音 (users.notification_sound)
 * ★ 2026-10-08: 機械の投稿はプッシュと同じく、ルームが「機械の投稿でも鳴らす」のときだけ鳴らす。
 *   機械かどうかは経路ごとに決まるので、サーバーが配信に添える push_kind を見る (docs/07 ②)
 * @param prefs.roomMuted その部屋の「このルームの通知」を切っている (room_members.push_muted)
 * @param prefs.machinePostsRing その部屋の「機械の投稿でも鳴らす」(rooms.push_machine_posts)
 */
export function shouldPlayMessageSound(
  msg: { sender_id?: string; type?: string; push_kind?: 'human' | 'machine' | 'off' },
  myId: string | undefined,
  prefs: { soundOn: boolean; roomMuted: boolean; machinePostsRing: boolean },
): boolean {
  if (!prefs.soundOn || prefs.roomMuted) return false;
  if (msg.sender_id === myId) return false;
  if (msg.type === 'system') return false;
  if (msg.push_kind === 'off') return false;
  if (msg.push_kind === 'machine' && !prefs.machinePostsRing) return false;
  return true;
}

/** 以前の端末ごとの保存 (localStorage)。2026-10-08 にアカウントの設定へ移した */
export const LEGACY_SOUND_KEY = 'notificationSound';

/**
 * 端末に残った「通知音を切る」をアカウントへ移すか (2026-10-08)。
 * ★ 移さないと、端末で切っていた人が更新した日から急に鳴り出す
 * ★ サーバーが設定を返さない (古い) ときは移さない
 */
export function shouldMoveLegacySoundOff(
  user: { notification_sound?: boolean },
  legacyValue: string | null,
): boolean {
  return legacyValue === 'off' && user.notification_sound === true;
}
