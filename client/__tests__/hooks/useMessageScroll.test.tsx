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

  // ★ #474 の残り: 裏のタブが自分で読み込み直したとき (新しい版への更新など) も、開いた部屋をまとめて既読にしていた。
  //   確認中に裏のタブを読み込み直したら 13 件が既読になった
  it('★★ 裏で部屋を開いた (読み込み直した) ときは既読にせず、見えるようになったら既読にする', () => {
    visibility = 'hidden';
    const hook = renderHook(() => useMessageScroll('room1'));
    hook.result.current.messagesEndRef.current = { scrollIntoView: vi.fn() } as unknown as HTMLDivElement;
    hook.result.current.messagesContainerRef.current = document.createElement('div');
    act(() => { vi.runAllTimers(); });
    expect(api.markRead).not.toHaveBeenCalled();

    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(api.markRead).toHaveBeenCalledTimes(1);
    expect(api.markRead).toHaveBeenCalledWith('room1', ['m0']);
  });

  it('★ 見えるようになる前に部屋を離れたら、既読にしない', () => {
    visibility = 'hidden';
    const hook = renderHook(() => useMessageScroll('room1'));
    hook.result.current.messagesEndRef.current = { scrollIntoView: vi.fn() } as unknown as HTMLDivElement;
    hook.result.current.messagesContainerRef.current = document.createElement('div');
    act(() => { vi.runAllTimers(); });
    hook.unmount();
    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(api.markRead).not.toHaveBeenCalled();
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

/**
 * #506 最下部まで見ている部屋で、長い新着や裏のタブだと画面が下まで追いかけなかった (監視中に新着が埋もれる)
 * ★ 本番で実測: 前に出ていて短い投稿 (71px) は追いかけるが、長い投稿 (218px) は 222px 取り残される。
 *   裏のタブでは短い投稿でも取り残される (滑らかなスクロールが裏では動かない)
 * ★ 直し方: 「最下部にいるか」はスクロールのたびに記録し、新着が来る前の状態で判定する。
 *   最下部にいたら一度に一番下へ合わせる。画像の読み込みなどで背が伸びても合わせ直す
 */
describe('useMessageScroll — 最下部にいたら新着を追いかける (#506)', () => {
  let visibility: DocumentVisibilityState = 'visible';

  /** 高さとスクロール位置を持たせた入れ物 (jsdom には高さの計算がない) */
  function makeContainer(clientHeight: number, scrollHeight: number) {
    const el = document.createElement('div');
    const box = { clientHeight, scrollHeight, scrollTop: Math.max(0, scrollHeight - clientHeight) };
    Object.defineProperty(el, 'clientHeight', { get: () => box.clientHeight });
    Object.defineProperty(el, 'scrollHeight', { get: () => box.scrollHeight });
    Object.defineProperty(el, 'scrollTop', { get: () => box.scrollTop, set: (v: number) => { box.scrollTop = Math.min(v, box.scrollHeight - box.clientHeight); } });
    return { el, box, gap: () => box.scrollHeight - box.scrollTop - box.clientHeight };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    visibility = 'visible';
    vi.mocked(api.markRead).mockReset().mockResolvedValue(undefined as never);
    messages = [{ id: 'm0', sender_id: 'other' }];
  });
  afterEach(() => vi.useRealTimers());

  function openAtBottom() {
    const c = makeContainer(700, 2000);
    const hook = renderHook(() => useMessageScroll('room1'));
    hook.result.current.messagesEndRef.current = { scrollIntoView: vi.fn() } as unknown as HTMLDivElement;
    hook.result.current.messagesContainerRef.current = c.el;
    act(() => { vi.runAllTimers(); });
    act(() => { hook.result.current.handleScroll(); });   // 最下部にいる
    return { ...hook, c };
  }

  it('★★★ 長い新着 (100px を超える) でも、最下部にいたら一番下まで合わせる', () => {
    const { rerender, c } = openAtBottom();
    c.box.scrollHeight += 218;                               // 描いたあと = 下端が伸びている
    messages = [...messages, { id: 'm1', sender_id: 'other' }];
    rerender();
    expect(c.gap()).toBe(0);
  });

  it('★★ 裏のタブでも合わせる (滑らかなスクロールに頼らない)', () => {
    const { rerender, c } = openAtBottom();
    visibility = 'hidden';
    c.box.scrollHeight += 71;
    messages = [...messages, { id: 'm1', sender_id: 'other' }];
    rerender();
    expect(c.gap()).toBe(0);
  });

  it('★★ 上にさかのぼって読んでいるときは動かさない', () => {
    const { result, rerender, c } = openAtBottom();
    c.box.scrollTop = 500;                                   // 上へ
    act(() => { result.current.handleScroll(); });
    c.box.scrollHeight += 71;
    messages = [...messages, { id: 'm1', sender_id: 'other' }];
    rerender();
    expect(c.box.scrollTop).toBe(500);
  });

  it('★ 最下部にいる間に画像が読み込まれて背が伸びたら、合わせ直す', () => {
    const { c } = openAtBottom();
    c.box.scrollHeight += 300;
    act(() => { c.el.dispatchEvent(new Event('load')); });   // 画像の load は伝わらないので、捕まえる側 (capture) で受ける
    expect(c.gap()).toBe(0);
  });

  it('上にいる間に画像が読み込まれても、動かさない', () => {
    const { result, c } = openAtBottom();
    c.box.scrollTop = 500;
    act(() => { result.current.handleScroll(); });
    c.box.scrollHeight += 300;
    act(() => { c.el.dispatchEvent(new Event('load')); });
    expect(c.box.scrollTop).toBe(500);
  });
});

/**
 * #507 マルチトークの「すべて最下部へ」。ツールバーから各パネル (iframe) の window へ scroll:bottom を送る
 * ★ 送信後の合図 (滑らか) とは違い、一度に一番下へ合わせ、「最下部にいる」記録も戻す (その後の新着も追いかける)
 */
describe('useMessageScroll — すべて最下部へ (#507)', () => {
  function makeContainer(clientHeight: number, scrollHeight: number) {
    const el = document.createElement('div');
    const box = { clientHeight, scrollHeight, scrollTop: Math.max(0, scrollHeight - clientHeight) };
    Object.defineProperty(el, 'clientHeight', { get: () => box.clientHeight });
    Object.defineProperty(el, 'scrollHeight', { get: () => box.scrollHeight });
    Object.defineProperty(el, 'scrollTop', { get: () => box.scrollTop, set: (v: number) => { box.scrollTop = Math.min(v, box.scrollHeight - box.clientHeight); } });
    return { el, box, gap: () => box.scrollHeight - box.scrollTop - box.clientHeight };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    vi.mocked(api.markRead).mockReset().mockResolvedValue(undefined as never);
    messages = [{ id: 'm0', sender_id: 'other' }];
  });
  afterEach(() => vi.useRealTimers());

  function openScrolledUp() {
    const c = makeContainer(700, 2000);
    const hook = renderHook(() => useMessageScroll('room1'));
    hook.result.current.messagesEndRef.current = { scrollIntoView: vi.fn() } as unknown as HTMLDivElement;
    hook.result.current.messagesContainerRef.current = c.el;
    act(() => { vi.runAllTimers(); });
    c.box.scrollTop = 300;                                   // 上へさかのぼっている
    act(() => { hook.result.current.handleScroll(); });
    return { ...hook, c };
  }

  it('★★ instant の合図で、待たずに一番下へ合わせる (滑らかなスクロールに頼らない)', () => {
    const { c } = openScrolledUp();
    act(() => { window.dispatchEvent(new CustomEvent('scroll:bottom', { detail: { instant: true } })); });
    expect(c.gap()).toBe(0);
  });

  it('★★ 合わせたあとは「最下部にいる」扱いになり、次の新着も追いかける', () => {
    const { rerender, c } = openScrolledUp();
    act(() => { window.dispatchEvent(new CustomEvent('scroll:bottom', { detail: { instant: true } })); });
    c.box.scrollHeight += 218;
    messages = [...messages, { id: 'm1', sender_id: 'other' }];
    rerender();
    expect(c.gap()).toBe(0);
  });

  it('instant の付かない合図 (送信後) は今までどおり滑らかに動かす', () => {
    const { result, c } = openScrolledUp();
    act(() => { window.dispatchEvent(new CustomEvent('scroll:bottom')); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.messagesEndRef.current!.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
    expect(c.box.scrollTop).toBe(300);
  });
});
