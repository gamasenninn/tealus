/**
 * #505 一度開いて離れた部屋は、読み込み直すまで一覧に新着が届かなかった
 *
 * ★ 部屋の画面 (useSocketSync) が離れるときに `room:leave` を送り、一覧 (RoomList) と同じ socket ごと
 *   その部屋から抜けていた。socket.io の部屋への出入りは socket 単位で数えない。
 *   → 窓口 (services/socket) で数え、最後の 1 つが抜けたときだけ `room:leave` を送る。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeSocket = {
  connected: false,
  on: vi.fn(() => fakeSocket),
  emit: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));
vi.mock('../src/stores/roomStore', () => ({ useRoomStore: { getState: () => ({ fetchRooms: vi.fn() }) } }));

const { connectSocket, disconnectSocket, joinRoom, leaveRoom } = await import('../src/services/socket');
const sent = (name: string) => fakeSocket.emit.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe('joinRoom / leaveRoom — 部屋への出入りを数える (#505)', () => {
  beforeEach(() => {
    disconnectSocket();
    connectSocket('t');
    fakeSocket.emit.mockClear();
  });

  it('★ 入るときは毎回 room:join を送る (つなぎ直し後でも確実に入る)', () => {
    joinRoom('r1');
    joinRoom('r1');
    expect(sent('room:join')).toEqual(['r1', 'r1']);
  });

  it('★★★ 一覧と部屋の画面が両方入っているとき、片方が抜けても room:leave を送らない', () => {
    joinRoom('r1');   // 一覧
    joinRoom('r1');   // 部屋の画面
    leaveRoom('r1');  // 部屋の画面が離れる
    expect(sent('room:leave')).toEqual([]);
  });

  it('★★ 最後の 1 つが抜けたときだけ room:leave を送る', () => {
    joinRoom('r1');
    joinRoom('r1');
    leaveRoom('r1');
    leaveRoom('r1');
    expect(sent('room:leave')).toEqual(['r1']);
  });

  it('入っていない部屋から抜けようとしても、何も送らない (数が負にならない)', () => {
    leaveRoom('r9');
    joinRoom('r9');
    leaveRoom('r9');
    expect(sent('room:leave')).toEqual(['r9']);
  });

  it('部屋ごとに別に数える', () => {
    joinRoom('r1');
    joinRoom('r2');
    leaveRoom('r1');
    expect(sent('room:leave')).toEqual(['r1']);
  });

  it('socket を作り直したら数えた分は捨てる (新しい接続では入り直しから始まる)', () => {
    joinRoom('r1');
    disconnectSocket();
    connectSocket('t');
    fakeSocket.emit.mockClear();
    joinRoom('r1');
    leaveRoom('r1');
    expect(sent('room:leave')).toEqual(['r1']);
  });
});
