/**
 * 鍵を延ばしたら、socket は作り直さずに、次につなぎ直すときから新しい鍵を渡す (2026-11-12、docs/05 §5)
 * ★ 作り直すと入っている部屋の記録 (roomRefs) が消える。接続時にしか鍵を見ないので、今の接続はそのまま使える
 * ★ 以前は io() に渡した鍵を持ち続け、つなぎ直したときに古い (切れた) 鍵で断られた
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AuthFn = (cb: (data: { token: string | null }) => void) => void;
const created: Array<{ opts: { auth: AuthFn } }> = [];
vi.mock('socket.io-client', () => ({
  io: vi.fn((_url: string, opts: { auth: AuthFn }) => {
    const s = { connected: false, on: vi.fn(() => s), emit: vi.fn(), disconnect: vi.fn() };
    created.push({ opts });
    return s;
  }),
}));
vi.mock('../src/stores/roomStore', () => ({ useRoomStore: { getState: () => ({ fetchRooms: vi.fn() }) } }));

const { connectSocket, disconnectSocket, updateSocketToken } = await import('../src/services/socket');

const tokenGivenOnConnect = (i: number): string | null => {
  let t: string | null = null;
  created[i].opts.auth((d) => { t = d.token; });
  return t;
};

describe('updateSocketToken', () => {
  beforeEach(() => { disconnectSocket(); created.length = 0; });

  it('★★ 鍵を延ばしても作り直さず、つなぎ直すときは新しい鍵を渡す', () => {
    const a = connectSocket('t1');
    expect(tokenGivenOnConnect(0)).toBe('t1');
    updateSocketToken('t2');
    expect(tokenGivenOnConnect(0)).toBe('t2');
    expect(created).toHaveLength(1);
    expect(connectSocket('t2')).toBe(a);   // ★ 起動し直しで新しい鍵が来ても同じ socket
  });

  it('socket が無いときは何もしない (ログアウト後に作らない)', () => {
    updateSocketToken('t9');
    expect(created).toHaveLength(0);
  });
});
