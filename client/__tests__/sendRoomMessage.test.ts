/**
 * sendRoomMessage — 送信の唯一経路。docs/05 §4 不変条件を明文で pin:
 * 「webhook は socket 経路 (message:send) のみ発火、REST は非発火」。
 * 4 箇所の同型実装 (MessageInput/FormBubble/ForwardModal/SharePage) を集約した契約の回帰網。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitMock = vi.fn();
const sendMessageMock = vi.fn().mockResolvedValue({});
let socketState: { connected: boolean } | null = { connected: true };

vi.mock('../src/services/socket', () => ({
  getSocket: () =>
    socketState
      ? { get connected() { return socketState!.connected; }, emit: (...a: unknown[]) => emitMock(...a) }
      : null,
}));
vi.mock('../src/services/api', () => ({
  api: { sendMessage: (...a: unknown[]) => sendMessageMock(...a) },
}));

import { sendRoomMessage } from '../src/services/sendRoomMessage';

describe('sendRoomMessage', () => {
  beforeEach(() => { emitMock.mockClear(); sendMessageMock.mockClear(); socketState = { connected: true }; });

  it('★ socket 接続時は message:send で emit、REST は使わない (webhook 発火経路)', async () => {
    const via = await sendRoomMessage({ roomId: 'r1', content: 'hi', replyTo: 'm1' });
    expect(via).toBe('socket');
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [event, payload] = emitMock.mock.calls[0];
    expect(event).toBe('message:send');
    expect(payload).toEqual({ room_id: 'r1', content: 'hi', reply_to: 'm1', forwarded_from: null });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('★ socket 切断時は REST(api.sendMessage) に fallback (webhook 非発火)', async () => {
    socketState = { connected: false };
    const via = await sendRoomMessage({ roomId: 'r1', content: 'hi', forwardedFrom: 'src1' });
    expect(via).toBe('rest');
    expect(sendMessageMock).toHaveBeenCalledWith('r1', 'hi', null, 'src1');
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('socket 未取得(null)でも REST に fallback', async () => {
    socketState = null;
    const via = await sendRoomMessage({ roomId: 'r1', content: 'hi' });
    expect(via).toBe('rest');
    expect(sendMessageMock).toHaveBeenCalledWith('r1', 'hi', null, null);
  });

  it('replyTo/forwardedFrom 省略時は null で送る (キー不在=null 等価)', async () => {
    await sendRoomMessage({ roomId: 'r1', content: 'hi' });
    expect(emitMock.mock.calls[0][1]).toEqual({ room_id: 'r1', content: 'hi', reply_to: null, forwarded_from: null });
  });
});
