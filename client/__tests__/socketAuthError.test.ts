/**
 * #539 socket のつなぎ直しが認証で断られたら (期限切れ・無効)、認証が切れたと知らせる
 * ★ 以前は console に出すだけで、切れたトークンのまま再試行を続けた
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (data?: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const fakeSocket = {
  connected: false,
  active: true,
  connect: vi.fn(),
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

  it('★★ 本体の DB の失敗などで断られた (再接続しない状態) なら、少し待って自分でつなぎ直す', () => {
    vi.useFakeTimers();
    try {
      connectSocket('t');
      fakeSocket.active = false;   // socket.io は本体のミドルウェアに断られると自動では再接続しない
      fakeSocket.connect.mockClear();
      handlers['connect_error'][0](new Error('サーバーエラーが発生しました'));
      expect(notifyUnauthorized).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    } finally { fakeSocket.active = true; vi.useRealTimers(); }
  });

  it('自動で再接続している最中 (ネットワーク) は、重ねてつながない', () => {
    vi.useFakeTimers();
    try {
      connectSocket('t');
      fakeSocket.connect.mockClear();
      handlers['connect_error'][0](new Error('xhr poll error'));
      vi.advanceTimersByTime(10_000);
      expect(fakeSocket.connect).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('★ 断られ続けたら待ちを倍にしていく (5 → 10 秒)。つながったら戻す', () => {
    vi.useFakeTimers();
    try {
      connectSocket('t');
      fakeSocket.active = false;
      fakeSocket.connect.mockClear();
      const fail = () => handlers['connect_error'][0](new Error('サーバーエラーが発生しました'));
      fail(); vi.advanceTimersByTime(5_000);
      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
      fail(); vi.advanceTimersByTime(5_000);
      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);   // 2 回目は 10 秒待つ
      vi.advanceTimersByTime(5_000);
      expect(fakeSocket.connect).toHaveBeenCalledTimes(2);
      handlers['connect'][0]();
      fail(); vi.advanceTimersByTime(5_000);
      expect(fakeSocket.connect).toHaveBeenCalledTimes(3);   // つながったら 5 秒に戻る
    } finally { fakeSocket.active = true; vi.useRealTimers(); }
  });
});
