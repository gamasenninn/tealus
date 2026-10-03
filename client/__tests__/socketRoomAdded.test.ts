/**
 * #486 新しく入った部屋が、読み込み直すまで出ない
 *
 * ★ サーバーは人が部屋に入ったとき本人に `room:added` を送る。受ける側は画面に関係なく
 *   (スマホでトークを開いている間も) 部屋の一覧を取り直す。一覧の部品 (RoomList) は部屋が 0 件だと
 *   受信の処理を何も登録せず、トークを開いている間は外れているので、そこでは受けられない。
 *   → socket を作るところ (connectSocket) で受ける。
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
vi.mock('../src/stores/roomStore', () => ({
  useRoomStore: { getState: () => ({ fetchRooms }) },
}));

const { connectSocket, disconnectSocket } = await import('../src/services/socket');

describe('connectSocket — room:added (#486)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
    fetchRooms.mockClear();
    fakeSocket.emit.mockClear();
    disconnectSocket();
  });

  it('room:added を受けたら部屋の一覧を取り直す', () => {
    connectSocket('t');
    expect(handlers['room:added']).toHaveLength(1);
    handlers['room:added'][0]({ room_id: 'r-1' });
    expect(fetchRooms).toHaveBeenCalledTimes(1);
  });

  it('その部屋の受信も登録し直す (サーバー側でも入れているが、再接続の後も確実にするため)', () => {
    connectSocket('t');
    handlers['room:added'][0]({ room_id: 'r-2' });
    expect(fakeSocket.emit).toHaveBeenCalledWith('room:join', 'r-2');
  });

  it('壊れた中身では何もしない (一覧は取り直さない)', () => {
    connectSocket('t');
    handlers['room:added'][0](null);
    handlers['room:added'][0]({});
    expect(fetchRooms).not.toHaveBeenCalled();
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('room:join', expect.anything());
  });
});
