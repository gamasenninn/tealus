/**
 * #511 日付・引用へ飛んだあと、下へスクロールすると途中で止まっていた
 *
 * 飛ぶときは around で「その投稿以降を 20 件」に入れ替えるが、読み足しは上 (古い方) 向きしか無かった。
 * 下 (新しい方) へも読み足し、最新まで読み終えたかを hasNewer で持つ。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/api', () => ({
  api: { getMessages: vi.fn(), getMessagesAfter: vi.fn() },
}));

import { useMessageStore } from '../src/stores/messageStore';
import { api } from '../src/services/api';

const m = (n: number) => ({ id: `m${n}`, room_id: 'r1', sender_id: 'u1', content: `${n}`, type: 'text', created_at: `2026-10-0${1 + (n % 5)}T00:00:00Z` }) as never;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => m(from + i));
const ids = () => useMessageStore.getState().messages.map((x) => x.id);

describe('messageStore — 新しい方へ読み足す (#511)', () => {
  beforeEach(() => {
    vi.mocked(api.getMessages).mockReset();
    vi.mocked(api.getMessagesAfter).mockReset();
    useMessageStore.setState({ messages: [], hasMore: true, hasNewer: false, isLoading: false } as never);
  });

  it('最新を読んだら hasNewer は false', async () => {
    vi.mocked(api.getMessages).mockResolvedValue({ messages: range(1, 20).reverse() } as never);
    await useMessageStore.getState().fetchMessages('r1');
    expect(useMessageStore.getState().hasNewer).toBe(false);
  });

  it('★ around で 20 件そろったら、まだ新しいものがある (hasNewer = true)', async () => {
    vi.mocked(api.getMessages).mockResolvedValue({ messages: range(1, 20) } as never);
    await useMessageStore.getState().fetchMessages('r1', 'm1');
    expect(useMessageStore.getState().hasNewer).toBe(true);
  });

  it('around で 20 件に満たなければ、最新まで届いている (hasNewer = false)', async () => {
    vi.mocked(api.getMessages).mockResolvedValue({ messages: range(1, 7) } as never);
    await useMessageStore.getState().fetchMessages('r1', 'm1');
    expect(useMessageStore.getState().hasNewer).toBe(false);
  });

  it('★ around で読んだあとも上へ読める (hasMore は件数で決めない。最近の日へ飛ぶと上にも動けなかった)', async () => {
    vi.mocked(api.getMessages).mockResolvedValue({ messages: range(1, 7) } as never);
    await useMessageStore.getState().fetchMessages('r1', 'm1');
    expect(useMessageStore.getState().hasMore).toBe(true);
  });

  it('★ loadNewer は一番新しい投稿の後ろを読み、後ろにつなぐ', async () => {
    useMessageStore.setState({ messages: range(1, 20), hasNewer: true } as never);
    vi.mocked(api.getMessagesAfter).mockResolvedValue({ messages: range(21, 40) } as never);
    await useMessageStore.getState().loadNewer('r1');
    expect(api.getMessagesAfter).toHaveBeenCalledWith('r1', 'm20');
    expect(ids()).toEqual(range(1, 40).map((x: { id: string }) => x.id));
    expect(useMessageStore.getState().hasNewer).toBe(true);
  });

  it('loadNewer で 20 件に満たなければ、最新まで届いた', async () => {
    useMessageStore.setState({ messages: range(1, 20), hasNewer: true } as never);
    vi.mocked(api.getMessagesAfter).mockResolvedValue({ messages: range(21, 25) } as never);
    await useMessageStore.getState().loadNewer('r1');
    expect(useMessageStore.getState().hasNewer).toBe(false);
  });

  it('loadNewer は、最新まで届いていれば読みに行かない', async () => {
    useMessageStore.setState({ messages: range(1, 5), hasNewer: false } as never);
    await useMessageStore.getState().loadNewer('r1');
    expect(api.getMessagesAfter).not.toHaveBeenCalled();
  });

  it('loadNewer は、すでにある投稿を二重に足さない', async () => {
    useMessageStore.setState({ messages: range(1, 20), hasNewer: true } as never);
    vi.mocked(api.getMessagesAfter).mockResolvedValue({ messages: range(20, 22) } as never);
    await useMessageStore.getState().loadNewer('r1');
    expect(ids().filter((x) => x === 'm20')).toHaveLength(1);
  });

  it('★★ 最新まで読み終えていない間に届いた新着は、後ろにつながない (間が抜けて見えていた)', () => {
    useMessageStore.setState({ messages: range(1, 20), hasNewer: true } as never);
    useMessageStore.getState().addMessage(m(99));
    expect(ids()).not.toContain('m99');
  });

  it('部屋を離れて空にしたら、印も戻す (次の部屋で新着が入らなくなる)', () => {
    useMessageStore.setState({ messages: range(1, 20), hasNewer: true } as never);
    useMessageStore.getState().clearMessages();
    expect(useMessageStore.getState().hasNewer).toBe(false);
  });

  it('最新まで読み終えていれば、新着は今までどおり後ろにつなぐ', () => {
    useMessageStore.setState({ messages: range(1, 20), hasNewer: false } as never);
    useMessageStore.getState().addMessage(m(99));
    expect(ids()).toContain('m99');
  });
});
