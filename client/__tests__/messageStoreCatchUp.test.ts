/**
 * #538 つなぎ直したとき・表に戻ったときに「追いつく」(catchUp)
 *
 * ★ 以前: つなぎ直しても開いている部屋を取り直さず、切れていた間の投稿が抜けたまま新着だけ足された。
 *   表に戻ったときは最新 20 件に丸ごと置き換え、読んでいた位置 (検索から開いた投稿も) が消えた。
 * ★ 今: 手元の最後より新しい分だけを取り、後ろに足す (置き換えない)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/api', () => ({
  api: { getMessages: vi.fn(), getMessagesAfter: vi.fn() },
}));

import { useMessageStore } from '../src/stores/messageStore';
import { api } from '../src/services/api';

const m = (n: number) => ({ id: `m${n}`, room_id: 'r1', sender_id: 'u1', content: `${n}`, type: 'text', created_at: '2026-10-09T00:00:00Z' }) as never;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => m(from + i));
const ids = () => useMessageStore.getState().messages.map((x) => x.id);

describe('messageStore.catchUp (#538)', () => {
  beforeEach(() => {
    vi.mocked(api.getMessages).mockReset();
    vi.mocked(api.getMessagesAfter).mockReset();
    useMessageStore.setState({ messages: range(1, 20), hasMore: true, hasNewer: false, isLoading: false } as never);
  });

  it('★★ 手元の最後より新しい分を後ろに足す (前の分はそのまま)', async () => {
    vi.mocked(api.getMessagesAfter).mockResolvedValue({ messages: range(21, 23) } as never);
    await useMessageStore.getState().catchUp('r1');
    expect(api.getMessagesAfter).toHaveBeenCalledWith('r1', 'm20', 20);
    expect(ids()).toEqual(range(1, 23).map((x) => (x as { id: string }).id));
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it('★ 20 件ずつ、最新に届くまで続けて取る', async () => {
    vi.mocked(api.getMessagesAfter)
      .mockResolvedValueOnce({ messages: range(21, 40) } as never)
      .mockResolvedValueOnce({ messages: range(41, 45) } as never);
    await useMessageStore.getState().catchUp('r1');
    expect(api.getMessagesAfter).toHaveBeenCalledTimes(2);
    expect(ids().at(-1)).toBe('m45');
  });

  it('★ 抜けが多すぎる (100 件を超える) なら、最新に置き換える', async () => {
    vi.mocked(api.getMessagesAfter).mockResolvedValue({ messages: range(21, 40) } as never);
    vi.mocked(api.getMessages).mockResolvedValue({ messages: range(500, 519).reverse() } as never);
    await useMessageStore.getState().catchUp('r1');
    expect(api.getMessagesAfter).toHaveBeenCalledTimes(5);
    expect(api.getMessages).toHaveBeenCalled();
    expect(ids()[0]).toBe('m500');
  });

  it('★★ 過去の位置を見ている最中 (下にまだ続きがある) なら何もしない', async () => {
    useMessageStore.setState({ hasNewer: true } as never);
    await useMessageStore.getState().catchUp('r1');
    expect(api.getMessagesAfter).not.toHaveBeenCalled();
    expect(api.getMessages).not.toHaveBeenCalled();
    expect(ids()).toHaveLength(20);
  });

  it('手元に何も無ければ最新を取る', async () => {
    useMessageStore.setState({ messages: [] } as never);
    vi.mocked(api.getMessages).mockResolvedValue({ messages: range(1, 3).reverse() } as never);
    await useMessageStore.getState().catchUp('r1');
    expect(api.getMessages).toHaveBeenCalled();
  });

  it('取れなくても投げない (つなぎ直しの処理を止めない)', async () => {
    vi.mocked(api.getMessagesAfter).mockRejectedValue(new Error('offline'));
    await expect(useMessageStore.getState().catchUp('r1')).resolves.toBeUndefined();
    expect(ids()).toHaveLength(20);
  });

  it('★ 開いた直後の読み込み中なら何もしない (検索から開いた位置を上書きしない)', async () => {
    useMessageStore.setState({ messages: [], isLoading: true } as never);
    await useMessageStore.getState().catchUp('r1');
    expect(api.getMessages).not.toHaveBeenCalled();
    expect(api.getMessagesAfter).not.toHaveBeenCalled();
  });
});
