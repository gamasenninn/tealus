/**
 * #533 部屋から外れた (自分で退会・外された) — 本体が本人の全端末へ `room:removed` を送る
 *
 * ★ 以前は本人に何も届かず、外された本人の画面には読み込み直すまで部屋が残った。
 *   受けたら一覧を取り直し、開いている部屋の画面へ知らせる (window の 'tealus:room-removed')
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

const getRooms = vi.fn(() => Promise.resolve({ rooms: [] }));
vi.mock('../src/services/api', () => ({ api: { getRoom: vi.fn(), getRooms: () => getRooms() } }));
vi.mock('../src/services/appBadge', () => ({ syncBadgeFromRooms: vi.fn() }));

const { connectSocket, disconnectSocket } = await import('../src/services/socket');

describe('room:removed (#533)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
    getRooms.mockClear();
    disconnectSocket();
  });

  it('★★ 一覧を取り直し、画面へ「この部屋から外れた」を知らせる', async () => {
    const seen: string[] = [];
    const onRemoved = (e: Event) => seen.push((e as CustomEvent<{ room_id: string }>).detail.room_id);
    window.addEventListener('tealus:room-removed', onRemoved);
    connectSocket('t');
    await handlers['room:removed'][0]({ room_id: 'r-1' });
    window.removeEventListener('tealus:room-removed', onRemoved);
    expect(getRooms).toHaveBeenCalled();
    expect(seen).toEqual(['r-1']);
  });

  it('壊れた中身では何もしない', async () => {
    connectSocket('t');
    await handlers['room:removed'][0](null);
    await handlers['room:removed'][0]({ room_id: 1 });
    expect(getRooms).not.toHaveBeenCalled();
  });
});
