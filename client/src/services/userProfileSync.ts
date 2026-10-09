import { useRoomStore } from '../stores/roomStore';
import { useMessageStore } from '../stores/messageStore';

/**
 * #534 同じ部屋の人が表示名・アイコンを変えた (本体の user:updated)。読み込み直さずに名前を差し替える。
 *
 * ★ 以前は本体が誰にも知らせず、1 対 1 の一覧・見出し・メンバー一覧・過去の吹き出しが古い名前のまま
 *   (新しい投稿だけ新しい名前で、同じ部屋に新旧の名前が混ざった)
 * ★ 開いている部屋のメンバーと読み込み済みの吹き出しはその場で差し替え、一覧は取り直す
 */
export function applyUserUpdated(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const d = data as { user_id?: unknown; display_name?: unknown; avatar_url?: unknown };
  if (typeof d.user_id !== 'string' || typeof d.display_name !== 'string') return;
  const userId = d.user_id;
  const displayName = d.display_name;
  const avatarUrl = typeof d.avatar_url === 'string' ? d.avatar_url : null;

  useRoomStore.setState((s) => ({
    members: s.members.map((m) => (m.user_id === userId ? { ...m, display_name: displayName, avatar_url: avatarUrl } : m)),
  }));
  useMessageStore.setState((s) => ({
    messages: s.messages.map((m) => (m.sender_id === userId
      ? { ...m, sender_display_name: displayName, sender_avatar_url: avatarUrl }
      : m)),
  }));
  void useRoomStore.getState().fetchRooms();
}
