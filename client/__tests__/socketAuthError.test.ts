/**
 * #539 socket のつなぎ直しが認証で断られたら (期限切れ・無効)、認証が切れたと知らせる
 * ★ 以前は console に出すだけで、切れたトークンのまま再試行を続けた
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
const notifyUnauthorized = vi.fn();
vi.mock('../src/services/api', () => ({ api: { getRoom: vi.fn(), getRooms: vi.fn(() => Promise.resolve({ rooms: [] })), notifyUnauthorized: () => notifyUnauthorized() } }));
vi.mock('../src/services/appBadge', () => ({ syncBadgeFromRooms: vi.fn() }));

const { connectSocket, disconnectSocket } = await import('../src/services/socket');

describe('socket の認証エラー (#539)', () => {
  beforeEach(() => { for (const k of Object.keys(handlers)) delete handlers[k]; notifyUnauthorized.mockClear(); disconnectSocket(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it.each(['トークンが無効です', 'ユーザーが見つかりません', '認証トークンがありません'])('★★ 「%s」なら認証が切れたと知らせる', (msg) => {
    connectSocket('t');
    handlers['connect_error'][0](new Error(msg));
    expect(notifyUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('つながらないだけ (ネットワーク) なら知らせない', () => {
    connectSocket('t');
    handlers['connect_error'][0](new Error('xhr poll error'));
    expect(notifyUnauthorized).not.toHaveBeenCalled();
  });
});
