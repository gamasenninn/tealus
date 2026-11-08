/**
 * 改善ループ 42: 部屋の知らせ (room:added / room:removed / room:updated) で一覧を取り直すとき、
 * タブ・パネル間で分け合う道 (fetchRoomsFromEvent) を通す。
 *
 * ★ 2026-11-07 に小野さんの画面 (パネル 8 つ) から GET /api/rooms が 1 分に 65 回出て [http-flood] に載った。
 *   パネルは同じオリジンなので、1 つの知らせを全パネルが受けてそれぞれ取りに行っていた。
 *   新着 (message:new) の取り直しは 11-01 に分け合う道へ移したが、この 3 つが直接 fetchRooms を呼んでいた
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (data?: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const fakeSocket = {
  connected: false,
  on: vi.fn((name: string, h: Handler) => { (handlers[name] ||= []).push(h); return fakeSocket; }),
  emit: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));

const fetchRooms = vi.fn(() => Promise.resolve());
const fetchRoomsFromEvent = vi.fn(() => Promise.resolve());
const refreshRoom = vi.fn(() => Promise.resolve());
vi.mock('../src/stores/roomStore', () => ({
  useRoomStore: { getState: () => ({ fetchRooms, refreshRoom }) },
  fetchRoomsFromEvent: () => fetchRoomsFromEvent(),
}));

const { connectSocket, disconnectSocket } = await import('../src/services/socket');

describe('部屋の知らせは分け合う道で一覧を取り直す (改善ループ 42)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
    fetchRooms.mockClear();
    fetchRoomsFromEvent.mockClear();
    disconnectSocket();
  });

  it.each(['room:added', 'room:removed', 'room:updated'])('%s', async (name) => {
    connectSocket('t');
    await handlers[name][0]({ room_id: 'r-1' });
    expect(fetchRoomsFromEvent).toHaveBeenCalledTimes(1);
    expect(fetchRooms).not.toHaveBeenCalled();
  });
});
