/**
 * #474 部屋を開いたままの端末が、画面が裏にある間も届いた投稿を既読にしていた
 *
 * useMessageScroll は「新しい投稿が増えたとき、いちばん下付近にいれば読み込んだ分をまとめて既読にする」。
 * ここも画面が見えているかを見ていなかった。裏にある間の分は useSocketSync が溜めて、戻ったときに既読にする。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let messages: { id: string; sender_id: string }[] = [];
vi.mock('../../src/stores/messageStore', () => ({
  useMessageStore: () => ({ messages, loadMore: vi.fn(), hasMore: false }),
}));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../src/stores/roomStore', () => {
  const useRoomStore = () => ({});
  (useRoomStore as unknown as { getState: () => unknown }).getState = () => ({ fetchRooms: vi.fn() });
  return { useRoomStore };
});
vi.mock('../../src/services/api', () => ({ api: { markRead: vi.fn() } }));
const emit = vi.fn();
vi.mock('../../src/services/socket', () => ({ getSocket: () => ({ emit }) }));

import { useMessageScroll } from '../../src/hooks/useMessageScroll';
import { api } from '../../src/services/api';

describe('useMessageScroll — 画面が見えているときだけ、まとめて既読にする (#474)', () => {
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    visibility = 'visible';
    vi.mocked(api.markRead).mockReset().mockResolvedValue(undefined as never);
    emit.mockReset();
    messages = [{ id: 'm0', sender_id: 'other' }];
  });
  afterEach(() => vi.useRealTimers());

  // 部屋を開いて初回の既読まで進めた状態を作る (いちばん下にいる)
  const openRoom = () => {
    const hook = renderHook(() => useMessageScroll('room1'));
    hook.result.current.messagesEndRef.current = { scrollIntoView: vi.fn() } as unknown as HTMLDivElement;
    hook.result.current.messagesContainerRef.current = document.createElement('div');   // jsdom の高さは 0 = いちばん下
    act(() => { vi.runAllTimers(); });
    vi.mocked(api.markRead).mockClear();
    emit.mockClear();
    return hook;
  };

  it('見えている間は、投稿が増えたら今までどおりまとめて既読にする', () => {
    const { rerender } = openRoom();
    messages = [...messages, { id: 'm1', sender_id: 'other' }];
    rerender();
    expect(api.markRead).toHaveBeenCalledWith('room1', ['m0', 'm1']);
  });

  it('★★ 裏にある間に投稿が増えても、既読にしない', () => {
    const { rerender } = openRoom();
    visibility = 'hidden';
    messages = [...messages, { id: 'm1', sender_id: 'other' }];
    rerender();
    expect(api.markRead).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
