/**
 * #600 トークを開いたとき、前に開いたときの中身を先に出し、取り直した分が届いたら置き換える。
 *
 * ★ 以前: 部屋を離れると messages を捨て、開くたびに見出しもメッセージも空から取り直した。
 *   夜に Cloudflare が東京以外の拠点で受け持つと往復が約 10 倍になり、「何もない画面」が目に見えた
 * ★ 覚える場所は画面を開いている間だけ (メモリ)。端末には書き残さない (共用の端末に会話が残らないように)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/api', () => ({
  api: { getMessages: vi.fn(), getMessagesAfter: vi.fn(), getRoom: vi.fn(), getRooms: vi.fn() },
}));
vi.mock('../src/services/appBadge', () => ({ syncBadgeFromRooms: vi.fn() }));

import { useMessageStore } from '../src/stores/messageStore';
import { useRoomStore } from '../src/stores/roomStore';
import { clearRoomViewCache } from '../src/stores/roomViewCache';
import { api } from '../src/services/api';

const m = (room: string, n: number) => ({ id: `${room}-m${n}`, room_id: room, sender_id: 'u2', content: `${n}`, type: 'text', created_at: '2026-10-13T00:00:00Z' }) as never;
const range = (room: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => m(room, from + i));
/** 本体は新しい順で返す */
const page = (room: string, from: number, to: number) => ({ messages: range(room, from, to).reverse() }) as never;
const ids = () => useMessageStore.getState().messages.map((x) => x.id);
const deferred = <T,>() => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const httpError = (status: number) => Object.assign(new Error('このルームへのアクセス権がありません'), { status });

/** 部屋を開いて、取り直しが届いてから離れる (useSocketSync の開閉と同じ順) */
async function visit(room: string, from: number, to: number) {
  vi.mocked(api.getMessages).mockResolvedValueOnce(page(room, from, to));
  await useMessageStore.getState().fetchMessages(room);
  useMessageStore.getState().clearMessages();
}

describe('messageStore: 前に開いたときの中身を先に出す (#600)', () => {
  beforeEach(() => {
    vi.mocked(api.getMessages).mockReset();
    clearRoomViewCache();
    useMessageStore.getState().clearMessages();
  });

  it('★★ 一度開いた部屋を開き直すと、取り直しを待たずに前の中身が出る。届いたら置き換わる (離れている間の新着も出る)', async () => {
    await visit('r1', 1, 20);
    const next = deferred<never>();
    vi.mocked(api.getMessages).mockReturnValueOnce(next.promise);
    const p = useMessageStore.getState().fetchMessages('r1');
    expect(ids()).toEqual(range('r1', 1, 20).map((x) => (x as { id: string }).id));
    expect(useMessageStore.getState().isStale).toBe(true);
    next.resolve(page('r1', 4, 23));
    await p;
    expect(ids().at(-1)).toBe('r1-m23');
    expect(ids()).toHaveLength(20);
    expect(useMessageStore.getState().isStale).toBe(false);
  });

  it('初めて開く部屋は空から (今までどおり)', async () => {
    const next = deferred<never>();
    vi.mocked(api.getMessages).mockReturnValueOnce(next.promise);
    const p = useMessageStore.getState().fetchMessages('r9');
    expect(ids()).toEqual([]);
    expect(useMessageStore.getState().isStale).toBe(false);
    next.resolve(page('r9', 1, 3));
    await p;
    expect(ids()).toHaveLength(3);
  });

  it('★ 開いている間に届いた新着・削除も含めて覚える (離れたときの姿)', async () => {
    vi.mocked(api.getMessages).mockResolvedValueOnce(page('r1', 1, 20));
    await useMessageStore.getState().fetchMessages('r1');
    useMessageStore.getState().addMessage(m('r1', 21));
    useMessageStore.getState().markDeleted('r1-m21');
    useMessageStore.getState().clearMessages();
    vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => {}));
    void useMessageStore.getState().fetchMessages('r1');
    const last = useMessageStore.getState().messages.at(-1)!;
    expect(last.id).toBe('r1-m21');
    expect(last.is_deleted).toBe(true);
  });

  it('★ 覚えるのは最新の 20 件まで (上へ読み足した分は覚えない)', async () => {
    vi.mocked(api.getMessages).mockResolvedValueOnce(page('r1', 21, 40)).mockResolvedValueOnce(page('r1', 1, 20));
    await useMessageStore.getState().fetchMessages('r1');
    await useMessageStore.getState().loadMore('r1');
    expect(ids()).toHaveLength(40);
    useMessageStore.getState().clearMessages();
    vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => {}));
    void useMessageStore.getState().fetchMessages('r1');
    expect(ids()).toHaveLength(20);
    expect(ids()[0]).toBe('r1-m21');
  });

  it('★★ 検索から特定の投稿に飛ぶ (around) ときは、覚えた分を出さずに取りに行く', async () => {
    await visit('r1', 1, 20);
    vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => {}));
    void useMessageStore.getState().fetchMessages('r1', 'r1-m5');
    expect(ids()).toEqual([]);
  });

  it('★ 過去の位置を見ていた (最新まで読んでいない) ときは覚え直さない (前の最新の姿が残る)', async () => {
    await visit('r1', 1, 20);
    vi.mocked(api.getMessages).mockResolvedValueOnce({ messages: range('r1', 100, 119) } as never);
    await useMessageStore.getState().fetchMessages('r1', 'r1-m100');
    expect(useMessageStore.getState().hasNewer).toBe(true);
    useMessageStore.getState().clearMessages();
    vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => {}));
    void useMessageStore.getState().fetchMessages('r1');
    expect(ids().at(-1)).toBe('r1-m20');
  });

  it('★★ 取り直しが 403 (外された)・404 (消された) なら、覚えた分を捨てて画面からも消す', async () => {
    for (const status of [403, 404]) {
      await visit('r1', 1, 20);
      vi.mocked(api.getMessages).mockRejectedValueOnce(httpError(status));
      await useMessageStore.getState().fetchMessages('r1');
      expect(ids()).toEqual([]);
      expect(useMessageStore.getState().error).toMatch(/アクセス権/);
      useMessageStore.getState().clearMessages();
      vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => {}));
      void useMessageStore.getState().fetchMessages('r1');
      expect(ids()).toEqual([]);
      useMessageStore.getState().clearMessages();
    }
  });

  it('★ 圏外などで取り直せないときは、前の中身を出したまま理由を添える (捨てない)', async () => {
    await visit('r1', 1, 20);
    vi.mocked(api.getMessages).mockRejectedValueOnce(new Error('通信できませんでした'));
    await useMessageStore.getState().fetchMessages('r1');
    expect(ids()).toHaveLength(20);
    expect(useMessageStore.getState().error).toMatch(/通信できませんでした/);
    expect(useMessageStore.getState().isStale).toBe(false);
  });

  it('★★ 離れた部屋の取り直しが遅れて届いても、今の部屋に書かない', async () => {
    const late = deferred<never>();
    vi.mocked(api.getMessages).mockReturnValueOnce(late.promise);
    const p = useMessageStore.getState().fetchMessages('r1');
    useMessageStore.getState().clearMessages();
    vi.mocked(api.getMessages).mockResolvedValueOnce(page('r2', 1, 5));
    await useMessageStore.getState().fetchMessages('r2');
    late.resolve(page('r1', 1, 20));
    await p;
    expect(ids()).toEqual(range('r2', 1, 5).map((x) => (x as { id: string }).id));
    expect(useMessageStore.getState().isLoading).toBe(false);
  });

  it('★ ログアウトなどで覚えた分を全部捨てる (clearRoomViewCache)', async () => {
    await visit('r1', 1, 20);
    clearRoomViewCache();
    vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => {}));
    void useMessageStore.getState().fetchMessages('r1');
    expect(ids()).toEqual([]);
  });

  it('★ 部屋から外れた知らせ (tealus:room-removed) で、その部屋の覚えた分を捨てる', async () => {
    await visit('r1', 1, 20);
    window.dispatchEvent(new CustomEvent('tealus:room-removed', { detail: { room_id: 'r1' } }));
    vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => {}));
    void useMessageStore.getState().fetchMessages('r1');
    expect(ids()).toEqual([]);
  });
});

describe('roomStore: 見出し・メンバーも前の分を先に出す (#600)', () => {
  const room = (id: string, name: string) => ({ id, name, type: 'group' }) as never;
  const members = [{ user_id: 'u1', display_name: 'A' }, { user_id: 'u2', display_name: 'B' }] as never;

  beforeEach(() => {
    vi.mocked(api.getRoom).mockReset();
    clearRoomViewCache();
    useRoomStore.getState().clearCurrentRoom();
    useRoomStore.setState({ error: null });
  });

  it('★★ 開き直すと、取り直しを待たずに見出しとメンバーが出る。未読の区切りは取り直した値で決める', async () => {
    vi.mocked(api.getRoom).mockResolvedValueOnce({ room: room('r1', '業務メモ'), members, last_read_message_id: 'old' } as never);
    await useRoomStore.getState().selectRoom('r1');
    useRoomStore.getState().clearCurrentRoom();

    const next = deferred<never>();
    vi.mocked(api.getRoom).mockReturnValueOnce(next.promise);
    const p = useRoomStore.getState().selectRoom('r1');
    expect(useRoomStore.getState().currentRoom?.name).toBe('業務メモ');
    expect(useRoomStore.getState().members).toHaveLength(2);
    expect(useRoomStore.getState().lastReadMessageId).toBeNull();
    next.resolve({ room: room('r1', '業務メモ (改)'), members, last_read_message_id: 'new' } as never);
    await p;
    expect(useRoomStore.getState().currentRoom?.name).toBe('業務メモ (改)');
    expect(useRoomStore.getState().lastReadMessageId).toBe('new');
  });

  it('★ 開いている部屋の取り直し (設定の変更後など) では出し直さない', async () => {
    vi.mocked(api.getRoom).mockResolvedValueOnce({ room: room('r1', '業務メモ'), members, last_read_message_id: 'x' } as never);
    await useRoomStore.getState().selectRoom('r1');
    vi.mocked(api.getRoom).mockReturnValueOnce(new Promise(() => {}));
    void useRoomStore.getState().selectRoom('r1');
    expect(useRoomStore.getState().lastReadMessageId).toBe('x');
  });

  it('★★ 取り直しが 403 / 404 なら、覚えた見出しを捨てて画面からも消す', async () => {
    vi.mocked(api.getRoom).mockResolvedValueOnce({ room: room('r1', '業務メモ'), members, last_read_message_id: null } as never);
    await useRoomStore.getState().selectRoom('r1');
    useRoomStore.getState().clearCurrentRoom();
    vi.mocked(api.getRoom).mockRejectedValueOnce(httpError(403));
    await useRoomStore.getState().selectRoom('r1');
    expect(useRoomStore.getState().currentRoom).toBeNull();
    expect(useRoomStore.getState().members).toEqual([]);
    expect(useRoomStore.getState().error).toMatch(/アクセス権/);
  });

  it('★★ 離れた部屋の取り直しが遅れて届いても、今の部屋の見出しにしない', async () => {
    const late = deferred<never>();
    vi.mocked(api.getRoom).mockReturnValueOnce(late.promise);
    const p = useRoomStore.getState().selectRoom('r1');
    useRoomStore.getState().clearCurrentRoom();
    vi.mocked(api.getRoom).mockResolvedValueOnce({ room: room('r2', 'AI班連絡'), members, last_read_message_id: null } as never);
    await useRoomStore.getState().selectRoom('r2');
    late.resolve({ room: room('r1', '業務メモ'), members, last_read_message_id: null } as never);
    await p;
    expect(useRoomStore.getState().currentRoom?.name).toBe('AI班連絡');
  });
});
