/**
 * socket は鍵ごとに 1 本 (2026-10-29 改善ループ 20 回目)
 *
 * ★ 以前は「接続済み」のときだけ使い回し、つなぎかけのときにもう一度呼ばれると io() を作り直していた。
 *   1 本目は窓口から外れたまま生き続け、ログアウトでも切れない (「つながっていません」の再試行が重なると起きた)。
 * ★ また鍵を見ていなかったので、ログアウトせずに /login から別の人が入ると、前の人の鍵の socket が使い回された。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sockets: Array<{ connected: boolean; on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const s = { connected: false, on: vi.fn(() => s), emit: vi.fn(), disconnect: vi.fn() };
    sockets.push(s);
    return s;
  }),
}));
vi.mock('../src/stores/roomStore', () => ({ useRoomStore: { getState: () => ({ fetchRooms: vi.fn() }) } }));

const { connectSocket, disconnectSocket } = await import('../src/services/socket');

describe('connectSocket', () => {
  beforeEach(() => { disconnectSocket(); sockets.length = 0; });

  it('★★ つなぎかけ (未接続) でも、同じ鍵なら作り直さない', () => {
    const a = connectSocket('t1');
    const b = connectSocket('t1');
    expect(b).toBe(a);
    expect(sockets).toHaveLength(1);
  });

  it('★ 鍵が違えば、前の socket を切って作り直す', () => {
    connectSocket('t1');
    connectSocket('t2');
    expect(sockets).toHaveLength(2);
    expect(sockets[0].disconnect).toHaveBeenCalled();
  });

  it('ログアウト (disconnectSocket) のあとは、同じ鍵でも作り直す', () => {
    connectSocket('t1');
    disconnectSocket();
    connectSocket('t1');
    expect(sockets).toHaveLength(2);
  });
});
