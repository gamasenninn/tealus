/**
 * #489 部屋の設定・メンバーの変化が、ほかのメンバーの画面に読み込み直すまで届かない
 *
 * ★ サーバーは部屋が変わると部屋へ `room:updated` を送る。受けたら一覧を取り直し、
 *   その部屋を開いていれば部屋の情報とメンバーを取り直す (見出しの人数・編集できるか が変わる)。
 * ★ 既読の位置 (lastReadMessageId) は取り直さない。未読の目印が動いてしまうため
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

const getRoom = vi.fn();
vi.mock('../src/services/api', () => ({ api: { getRoom: (...a: unknown[]) => getRoom(...a), getRooms: vi.fn(() => Promise.resolve({ rooms: [] })) } }));
vi.mock('../src/services/appBadge', () => ({ syncBadgeFromRooms: vi.fn() }));

const { useRoomStore } = await import('../src/stores/roomStore');
const { connectSocket, disconnectSocket } = await import('../src/services/socket');

describe('room:updated (#489)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
    getRoom.mockReset();
    disconnectSocket();
    useRoomStore.setState({
      currentRoom: { id: 'r-1', type: 'group', name: '古い名前', message_edit_policy: 'none' } as never,
      members: [{ user_id: 'u-a' }, { user_id: 'u-b' }] as never,
      lastReadMessageId: 'm-old',
    });
  });

  it('開いている部屋なら、部屋の情報とメンバーを取り直す (★ 既読の位置は動かさない)', async () => {
    getRoom.mockResolvedValue({
      room: { id: 'r-1', type: 'group', name: '古い名前', message_edit_policy: 'sender' },
      members: [{ user_id: 'u-a' }],
      last_read_message_id: 'm-new',
    });
    connectSocket('t');
    await handlers['room:updated'][0]({ room_id: 'r-1' });
    await vi.waitFor(() => expect(useRoomStore.getState().members).toHaveLength(1));
    const s = useRoomStore.getState();
    expect((s.currentRoom as { message_edit_policy?: string }).message_edit_policy).toBe('sender');
    expect(s.lastReadMessageId).toBe('m-old');
  });

  it('開いていない部屋なら、部屋の情報は取りに行かない (一覧だけ取り直す)', async () => {
    connectSocket('t');
    await handlers['room:updated'][0]({ room_id: 'r-other' });
    expect(getRoom).not.toHaveBeenCalled();
    expect(useRoomStore.getState().members).toHaveLength(2);
  });

  it('壊れた中身では何もしない', async () => {
    connectSocket('t');
    await handlers['room:updated'][0](null);
    await handlers['room:updated'][0]({});
    expect(getRoom).not.toHaveBeenCalled();
  });
});
