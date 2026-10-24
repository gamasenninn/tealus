/**
 * 部屋の一覧の取り直しを重ねない (改善ループ 13 回目の「遅い道」の 6、2026-10-24)
 *
 * ★ 部屋を開く 1 操作で GET /api/rooms が 2〜3 本重なっていた (既読の後・socket の知らせ・一覧の画面がそれぞれ呼ぶ)。
 *   10-22 は 1,730 本 / (利用者,秒) 777 = 平均 2.2 倍。走っている間に来た呼び出しは、終わった後に 1 回だけまとめて取り直す
 * ★★ 走っている間に来た呼び出しも「呼んだ後の状態」を受け取れること (まとめた分の取り直しは必ず 1 回走る)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRooms = vi.fn();
vi.mock('../src/services/api', () => ({ api: { getRooms: () => getRooms() } }));
vi.mock('../src/services/appBadge', () => ({ syncBadgeFromRooms: vi.fn() }));

import { useRoomStore } from '../src/stores/roomStore';

describe('fetchRooms — 走っている間の呼び出しはまとめる', () => {
  beforeEach(() => { getRooms.mockReset(); useRoomStore.setState({ rooms: [] }); });

  it('★ 同時に 3 回呼んでも、取りに行くのは「最初の 1 回 + まとめた 1 回」の 2 回', async () => {
    let n = 0;
    getRooms.mockImplementation(async () => { n++; await new Promise((r) => setTimeout(r, 10)); return { rooms: [{ id: `v${n}` }] }; });
    const s = useRoomStore.getState();
    await Promise.all([s.fetchRooms(), s.fetchRooms(), s.fetchRooms()]);
    expect(getRooms).toHaveBeenCalledTimes(2);
    // 後から呼んだ人も、呼んだ後に取った結果を受け取っている
    expect(useRoomStore.getState().rooms).toEqual([{ id: 'v2' }]);
  });

  it('重ならなければ、呼ぶたびに取りに行く (今までどおり)', async () => {
    getRooms.mockResolvedValue({ rooms: [] });
    await useRoomStore.getState().fetchRooms();
    await useRoomStore.getState().fetchRooms();
    expect(getRooms).toHaveBeenCalledTimes(2);
  });
});
