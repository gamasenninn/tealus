/**
 * #534 同じ部屋の人が表示名・アイコンを変えたら (user:updated)、読み込み直さずに名前を差し替える
 * ★ 以前は 1 対 1 の一覧・見出し・メンバー一覧・過去の吹き出しが古い名前のまま (新しい投稿だけ新しい名前)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchRooms = vi.fn();
import { useRoomStore } from '../../src/stores/roomStore';
import { useMessageStore } from '../../src/stores/messageStore';
import { applyUserUpdated } from '../../src/services/userProfileSync';

beforeEach(() => {
  fetchRooms.mockClear();
  useRoomStore.setState({
    fetchRooms,
    members: [
      { user_id: 'u-tanaka', id: 'u-tanaka', display_name: '田中', avatar_url: null },
      { user_id: 'u-other', id: 'u-other', display_name: '佐藤', avatar_url: null },
    ] as never,
  });
  useMessageStore.setState({
    messages: [
      { id: 'm1', sender_id: 'u-tanaka', sender_display_name: '田中', sender_avatar_url: null, content: 'a' },
      { id: 'm2', sender_id: 'u-other', sender_display_name: '佐藤', sender_avatar_url: null, content: 'b' },
    ] as never,
  });
});

describe('applyUserUpdated (#534)', () => {
  const data = { user_id: 'u-tanaka', display_name: '田中 (営業)', avatar_url: 'avatars/t.png' };

  it('★★ 開いている部屋のメンバーの名前とアイコンを差し替える', () => {
    applyUserUpdated(data);
    const m = useRoomStore.getState().members;
    expect(m.find((x) => x.user_id === 'u-tanaka')).toMatchObject({ display_name: '田中 (営業)', avatar_url: 'avatars/t.png' });
    expect(m.find((x) => x.user_id === 'u-other')).toMatchObject({ display_name: '佐藤' });
  });

  it('★★ 読み込み済みの吹き出しの名前とアイコンを差し替える (その人の分だけ)', () => {
    applyUserUpdated(data);
    const msgs = useMessageStore.getState().messages;
    expect(msgs[0]).toMatchObject({ sender_display_name: '田中 (営業)', sender_avatar_url: 'avatars/t.png' });
    expect(msgs[1]).toMatchObject({ sender_display_name: '佐藤' });
  });

  it('★ 部屋の一覧を取り直す (1 対 1 の相手の名前)', () => {
    applyUserUpdated(data);
    expect(fetchRooms).toHaveBeenCalled();
  });

  it('壊れた中身では何もしない', () => {
    applyUserUpdated(null);
    applyUserUpdated({ user_id: 1 });
    applyUserUpdated({ user_id: 'u-tanaka' });   // 名前が無い
    expect(fetchRooms).not.toHaveBeenCalled();
    expect(useMessageStore.getState().messages[0]).toMatchObject({ sender_display_name: '田中' });
  });
});
