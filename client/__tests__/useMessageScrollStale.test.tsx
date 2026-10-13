/**
 * #600 前に開いたときの中身 (isStale) を出している間は、まだ「開いた直後」として扱う
 *
 * ★ 既読にしない: 覚えた分は前に見た姿で、離れている間の新着は入っていない。取り直しが届いてから既読にする
 * ★ 取り直しが同じ 20 件で届いても (件数が変わらなくても)、届いたことを拾って既読にする
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const state = vi.hoisted(() => ({
  messages: [] as { id: string; sender_id: string }[],
  isStale: false,
  hasMore: true, hasNewer: false,
  loadMore: () => Promise.resolve(), loadNewer: () => Promise.resolve(), fetchMessages: () => Promise.resolve(),
}));
vi.mock('../src/stores/messageStore', () => ({ useMessageStore: () => state }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'me' } }) }));
vi.mock('../src/stores/roomStore', () => ({ useRoomStore: { getState: () => ({ fetchRooms: vi.fn() }) } }));
vi.mock('../src/services/socket', () => ({ getSocket: () => null }));
const markRead = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../src/services/api', () => ({ api: { markRead } }));

import { useMessageScroll } from '../src/hooks/useMessageScroll';

const msgs = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `m${from + i}`, sender_id: 'other' }));

describe('useMessageScroll: 前の中身を出している間 (#600)', () => {
  beforeEach(() => { vi.useFakeTimers(); markRead.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('★★ 覚えた分を出している間は既読にせず、同じ件数で取り直しが届いたら新しい分を既読にする', () => {
    state.messages = msgs(1, 20); state.isStale = true;
    const { rerender } = renderHook(() => useMessageScroll('r1'));
    vi.advanceTimersByTime(200);
    expect(markRead).not.toHaveBeenCalled();

    state.messages = msgs(4, 23); state.isStale = false;
    rerender();
    vi.advanceTimersByTime(200);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect((markRead.mock.calls[0] as unknown as [string, string[]])[1]).toContain('m23');
  });

  it('★ 覚えた分を出している間のスクロールは、読み込み直し用の位置 (scrollPos) に書かない (届いたときに一番下へ行かなくなる)', () => {
    sessionStorage.clear();
    state.messages = msgs(1, 20); state.isStale = true;
    const { result } = renderHook(() => useMessageScroll('r3'));
    (result.current.messagesContainerRef as { current: unknown }).current = { scrollTop: 300, scrollHeight: 1000, clientHeight: 700, addEventListener: vi.fn() };
    result.current.handleScroll();
    expect(sessionStorage.getItem('scrollPos:r3')).toBeNull();
  });

  it('初めて開く部屋 (覚えた分なし) は今までどおり、届いたら既読にする', () => {
    state.messages = []; state.isStale = false;
    const { rerender } = renderHook(() => useMessageScroll('r2'));
    state.messages = msgs(1, 5);
    rerender();
    vi.advanceTimersByTime(200);
    expect(markRead).toHaveBeenCalledTimes(1);
  });
});
