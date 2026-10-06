/**
 * #511 日付・引用へ飛んだあと、下へスクロールすると途中で止まっていた (スクロール側)
 *
 * - 下端に近づいたら新しい方を読み足す (上の loadMore と対)
 * - 最新まで読み終えていない間は、一番下へ追いかけない (読み足すたびに下へ飛ばされ、最新まで一気に流れる)
 * - 送信などの「最下部へ」は、最新まで読み終えていなければ読み直してから
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const state = {
  messages: [] as { id: string; sender_id: string }[],
  hasMore: false,
  hasNewer: false,
  loadMore: vi.fn(),
  loadNewer: vi.fn(),
  fetchMessages: vi.fn(),
};
vi.mock('../../src/stores/messageStore', () => {
  const useMessageStore = () => state;
  (useMessageStore as unknown as { getState: () => unknown }).getState = () => state;
  return { useMessageStore };
});
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../src/stores/roomStore', () => {
  const useRoomStore = () => ({});
  (useRoomStore as unknown as { getState: () => unknown }).getState = () => ({ fetchRooms: vi.fn() });
  return { useRoomStore };
});
vi.mock('../../src/services/api', () => ({ api: { markRead: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../src/services/socket', () => ({ getSocket: () => ({ emit: vi.fn() }) }));

import { useMessageScroll } from '../../src/hooks/useMessageScroll';

/** 高さを持たせた入れ物。scrollTop への代入を数える */
function container(scrollHeight: number, clientHeight: number, scrollTop: number) {
  const el = document.createElement('div');
  let top = scrollTop;
  const sets: number[] = [];
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; sets.push(v); } });
  return { el, sets, setHeight: (h: number) => { scrollHeight = h; } };
}

describe('useMessageScroll — 新しい方へ読み足す (#511)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.messages = [{ id: 'm1', sender_id: 'other' }];
    state.hasNewer = false;
    state.loadNewer = vi.fn().mockResolvedValue(undefined);
    state.fetchMessages = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  const open = (c: ReturnType<typeof container>) => {
    const hook = renderHook(() => useMessageScroll('room1'));
    hook.result.current.messagesEndRef.current = { scrollIntoView: vi.fn() } as unknown as HTMLDivElement;
    hook.result.current.messagesContainerRef.current = c.el;
    act(() => { vi.runAllTimers(); });
    return hook;
  };

  it('★ 最新まで読み終えていなければ、下端に近づいたら読み足す', () => {
    const c = container(2000, 500, 0);
    const hook = open(c);
    state.hasNewer = true;
    hook.rerender();
    c.el.scrollTop = 1450;   // 下端まで 50px
    act(() => { hook.result.current.handleScroll(); });
    expect(state.loadNewer).toHaveBeenCalledWith('room1');
  });

  it('下端から遠ければ読み足さない', () => {
    const c = container(5000, 500, 0);
    const hook = open(c);
    state.hasNewer = true;
    hook.rerender();
    c.el.scrollTop = 1000;
    act(() => { hook.result.current.handleScroll(); });
    expect(state.loadNewer).not.toHaveBeenCalled();
  });

  it('最新まで読み終えていれば読み足さない', () => {
    const c = container(2000, 500, 0);
    const hook = open(c);
    c.el.scrollTop = 1500;
    act(() => { hook.result.current.handleScroll(); });
    expect(state.loadNewer).not.toHaveBeenCalled();
  });

  it('読み足しの途中は、重ねて読みに行かない', () => {
    state.loadNewer = vi.fn(() => new Promise<void>(() => {}));   // 終わらない
    const c = container(2000, 500, 0);
    const hook = open(c);
    state.hasNewer = true;
    hook.rerender();
    c.el.scrollTop = 1500;
    act(() => { hook.result.current.handleScroll(); hook.result.current.handleScroll(); });
    expect(state.loadNewer).toHaveBeenCalledTimes(1);
  });

  it('★★ 最新まで読み終えていない間は、投稿が増えても一番下へ追いかけない', () => {
    const c = container(2000, 500, 0);
    const hook = open(c);
    state.hasNewer = true;
    hook.rerender();
    c.el.scrollTop = 1500;   // 一番下にいる
    act(() => { hook.result.current.handleScroll(); });
    c.sets.length = 0;
    c.setHeight(4000);
    state.messages = [...state.messages, { id: 'm2', sender_id: 'other' }];
    hook.rerender();
    expect(c.sets).toEqual([]);
  });

  it('★ 「最下部へ」は、最新まで読み終えていなければ最新を読み直す', async () => {
    const c = container(2000, 500, 0);
    const hook = open(c);
    state.hasNewer = true;
    hook.rerender();
    await act(async () => { window.dispatchEvent(new CustomEvent('scroll:bottom')); });
    expect(state.fetchMessages).toHaveBeenCalledWith('room1');
  });

  it('「最下部へ」は、最新まで読み終えていれば読み直さない (今までどおり)', async () => {
    const c = container(2000, 500, 0);
    open(c);
    await act(async () => { window.dispatchEvent(new CustomEvent('scroll:bottom')); });
    expect(state.fetchMessages).not.toHaveBeenCalled();
  });
});
