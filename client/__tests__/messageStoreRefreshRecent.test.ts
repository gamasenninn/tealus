/**
 * つなぎ直したとき、表示中の投稿の中身 (編集・削除・既読 N・スタンプ・文字起こし) を取り直す (2026-10-30 改善ループ 27 回目)
 *
 * ★ #538 の catchUp は「手元の最後より新しい投稿」しか取らないので、切れていた間に既にある投稿へ起きた変化が古いままだった。
 *   iPhone では「開く = つなぎ直す」なので、音声便が「文字起こし中...」のまま残るのが毎日の形 (部屋を開き直すまで)
 * ★ 置き換えずに差し替える (置き換えると読んでいた位置が飛ぶ = #538 で避けた形)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/api', () => ({
  api: { getMessages: vi.fn(), getMessagesAfter: vi.fn() },
}));
const evictRoomView = vi.fn();
vi.mock('../src/stores/roomViewCache', () => ({
  getCachedMessages: vi.fn(), cacheMessages: vi.fn(), evictRoomView: (id: string) => evictRoomView(id),
  isGoneFromRoom: (err: { status?: number }) => err?.status === 403 || err?.status === 404, markRoomReachable: vi.fn(),
}));

import { useMessageStore } from '../src/stores/messageStore';
import { api } from '../src/services/api';

const m = (n: number, extra: Record<string, unknown> = {}) => ({ id: `m${n}`, room_id: 'r1', sender_id: 'u1', content: `${n}`, type: 'text', created_at: '2026-10-09T00:00:00Z', ...extra }) as never;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => m(from + i));

describe('messageStore.refreshRecent', () => {
  beforeEach(() => {
    vi.mocked(api.getMessages).mockReset();
    evictRoomView.mockClear();
    useMessageStore.setState({ roomId: 'r1', messages: range(1, 30), hasMore: true, hasNewer: false, isLoading: false } as never);
  });

  it('★★ 最新 20 件を取り、手元にある同じ投稿だけ差し替える (並びと数は変えない)', async () => {
    // API は新しい順で返す
    const latest = range(11, 30).reverse().map((x) => ((x as { id: string }).id === 'm29' ? m(29, { is_deleted: true, read_count: 3 }) : x));
    vi.mocked(api.getMessages).mockResolvedValue({ messages: latest } as never);
    await useMessageStore.getState().refreshRecent('r1');
    const msgs = useMessageStore.getState().messages as unknown as { id: string; is_deleted?: boolean; read_count?: number }[];
    expect(msgs.map((x) => x.id)).toEqual(range(1, 30).map((x) => (x as { id: string }).id));
    expect(msgs.find((x) => x.id === 'm29')).toMatchObject({ is_deleted: true, read_count: 3 });
  });

  it('★ 外された・消された部屋 (403/404) なら、覚えた分を捨てて「外された」を流す', async () => {
    vi.mocked(api.getMessages).mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const got: string[] = [];
    const on = (e: Event) => got.push((e as CustomEvent).detail.room_id);
    window.addEventListener('tealus:room-removed', on);
    await useMessageStore.getState().refreshRecent('r1');
    window.removeEventListener('tealus:room-removed', on);
    expect(evictRoomView).toHaveBeenCalledWith('r1');
    expect(got).toEqual(['r1']);
  });

  it('過去の位置を見ている最中 (hasNewer) は取りに行かない', async () => {
    useMessageStore.setState({ hasNewer: true } as never);
    await useMessageStore.getState().refreshRecent('r1');
    expect(api.getMessages).not.toHaveBeenCalled();
  });
});
