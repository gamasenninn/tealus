/**
 * 部屋の一覧の取り直しを、同じ人のタブどうしで分け合う (2026-11-01 Q0 の 7)
 *
 * ★ 既読 1 回ごとに本体が同じ人の全タブへ unread:changed を送り、各タブがそれぞれ GET /api/rooms していた。
 *   小野さんは同時に 14〜22 タブ開いていて、10-31 は既読 381 本に対し取り直しが 974 本 (うち 834 本が既読から 1.5 秒以内)。
 *   まとめ (改善ループ 14) は 1 タブの中でしか効いていなかった
 * ここで固定する:
 *   1. 取り直した結果は、同じ人の他のタブへ配る (BroadcastChannel、名前に利用者の ID を入れる)
 *   2. socket の知らせで取り直すときは少しだけ待ち、その間に「知らせより後に取りに行った」結果が届いたら自分は取りに行かない
 *   3. 古い結果で新しい一覧を上書きしない
 *   4. ログアウトしたら配られても入れない
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getRooms = vi.fn();
vi.mock('../src/services/api', () => ({ api: { getRooms: () => getRooms() } }));
vi.mock('../src/services/appBadge', () => ({ syncBadgeFromRooms: vi.fn() }));

import { useRoomStore, bindRoomsChannel, fetchRoomsFromEvent } from '../src/stores/roomStore';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let otherTab: BroadcastChannel;

beforeEach(() => {
  getRooms.mockReset();
  getRooms.mockResolvedValue({ rooms: [{ id: 'mine' }] });
  useRoomStore.getState().reset();
  bindRoomsChannel('me');
  otherTab = new BroadcastChannel('tealus-rooms:me');
});
afterEach(() => { otherTab.close(); useRoomStore.getState().reset(); });

describe('部屋の一覧をタブどうしで分け合う', () => {
  it('★★ 他のタブが取り直した結果が届いたら、一覧に入れる', async () => {
    otherTab.postMessage({ startedAt: Date.now(), rooms: [{ id: 'from-other' }] });
    await wait(20);
    expect(useRoomStore.getState().rooms).toEqual([{ id: 'from-other' }]);
  });

  it('★★ 知らせのあと待っている間に、知らせより後に取りに行った結果が届けば、自分は取りに行かない', async () => {
    void fetchRoomsFromEvent(50);
    otherTab.postMessage({ startedAt: Date.now() + 1, rooms: [{ id: 'fresh' }] });
    await wait(100);
    expect(getRooms).not.toHaveBeenCalled();
    expect(useRoomStore.getState().rooms).toEqual([{ id: 'fresh' }]);
  });

  it('★ 知らせより前に取りに行った結果では、取り直しをやめない', async () => {
    const before = Date.now() - 1000;
    void fetchRoomsFromEvent(50);
    otherTab.postMessage({ startedAt: before, rooms: [{ id: 'stale' }] });
    await wait(100);
    expect(getRooms).toHaveBeenCalledTimes(1);
  });

  it('何も届かなければ、待ったあとに 1 回取りに行く', async () => {
    void fetchRoomsFromEvent(30);
    expect(getRooms).not.toHaveBeenCalled();
    await wait(80);
    expect(getRooms).toHaveBeenCalledTimes(1);
  });

  it('★ 自分で取り直した結果は、他のタブへ配る', async () => {
    const got: unknown[] = [];
    otherTab.onmessage = (e) => got.push(e.data);
    await useRoomStore.getState().fetchRooms();
    await wait(20);
    expect(got).toEqual([expect.objectContaining({ rooms: [{ id: 'mine' }] })]);
  });

  it('★ 古い結果で新しい一覧を上書きしない', async () => {
    const t = Date.now();
    otherTab.postMessage({ startedAt: t + 10, rooms: [{ id: 'new' }] });
    await wait(20);
    otherTab.postMessage({ startedAt: t, rooms: [{ id: 'old' }] });
    await wait(20);
    expect(useRoomStore.getState().rooms).toEqual([{ id: 'new' }]);
  });

  it('★ ログアウト (reset) したら、配られても入れない', async () => {
    useRoomStore.getState().reset();
    otherTab.postMessage({ startedAt: Date.now(), rooms: [{ id: 'after-logout' }] });
    await wait(20);
    expect(useRoomStore.getState().rooms).toEqual([]);
  });
});
