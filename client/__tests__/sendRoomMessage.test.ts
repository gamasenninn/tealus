/**
 * sendRoomMessage — 送信の唯一経路。docs/05 §4 不変条件を明文で pin:
 * 「webhook は socket 経路 (message:send) のみ発火、REST は非発火」。
 * 4 箇所の同型実装 (MessageInput/FormBubble/ForwardModal/SharePage) を集約した契約の回帰網。
 *
 * ★ #537 (2026-10-09) つながっていないときも REST に回さない。つながり直すのを待って socket で送り、
 *   つながらなければ投げる。以前は REST に回して、配信もプッシュもアシスタントも動かない便が DB にだけ入った
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitMock = vi.fn();
const sendMessageMock = vi.fn().mockResolvedValue({});
type Listener = () => void;
let socketState: { connected: boolean; listeners: Map<string, Listener[]> } | null;

const fakeSocket = () => ({
  get connected() { return socketState!.connected; },
  emit: (...a: unknown[]) => emitMock(...a),
  once: (ev: string, fn: Listener) => { const l = socketState!.listeners.get(ev) ?? []; l.push(fn); socketState!.listeners.set(ev, l); },
  off: (ev: string, fn: Listener) => { socketState!.listeners.set(ev, (socketState!.listeners.get(ev) ?? []).filter((x) => x !== fn)); },
});
const connectNow = () => { socketState!.connected = true; for (const fn of socketState!.listeners.get('connect') ?? []) fn(); };

vi.mock('../src/services/socket', () => ({ getSocket: () => (socketState ? fakeSocket() : null) }));
vi.mock('../src/services/api', () => ({ api: { sendMessage: (...a: unknown[]) => sendMessageMock(...a) } }));

import { sendRoomMessage } from '../src/services/sendRoomMessage';

describe('sendRoomMessage', () => {
  beforeEach(() => {
    emitMock.mockClear(); sendMessageMock.mockClear();
    socketState = { connected: true, listeners: new Map() };
  });

  it('★ socket 接続時は message:send で emit、REST は使わない (webhook 発火経路)', async () => {
    const via = await sendRoomMessage({ roomId: 'r1', content: 'hi', replyTo: 'm1' });
    expect(via).toBe('socket');
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [event, payload] = emitMock.mock.calls[0];
    expect(event).toBe('message:send');
    expect(payload).toEqual({ room_id: 'r1', content: 'hi', reply_to: 'm1', forwarded_from: null });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('★★ 切れていても、待つ間につながれば socket で送る (REST に回さない)', async () => {
    socketState!.connected = false;
    const p = sendRoomMessage({ roomId: 'r1', content: 'hi', forwardedFrom: 'src1' }, { waitMs: 1000 });
    expect(emitMock).not.toHaveBeenCalled();
    connectNow();
    await expect(p).resolves.toBe('socket');
    expect(emitMock).toHaveBeenCalledWith('message:send', { room_id: 'r1', content: 'hi', reply_to: null, forwarded_from: 'src1' });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('★★ 待ってもつながらなければ投げる (REST に回さない・送らない)', async () => {
    socketState!.connected = false;
    await expect(sendRoomMessage({ roomId: 'r1', content: 'hi' }, { waitMs: 20 })).rejects.toThrow(/つながっていない/);
    expect(emitMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(socketState!.listeners.get('connect') ?? []).toHaveLength(0);   // 待ちは片づける
  });

  it('socket 未取得 (null) なら投げる (REST に回さない)', async () => {
    socketState = null;
    await expect(sendRoomMessage({ roomId: 'r1', content: 'hi' }, { waitMs: 20 })).rejects.toThrow(/つながっていない/);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('replyTo/forwardedFrom 省略時は null で送る (キー不在=null 等価)', async () => {
    await sendRoomMessage({ roomId: 'r1', content: 'hi' });
    expect(emitMock.mock.calls[0][1]).toEqual({ room_id: 'r1', content: 'hi', reply_to: null, forwarded_from: null });
  });
});
