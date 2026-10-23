/**
 * sendRoomMessage — 送信の唯一経路。docs/05 §4 不変条件を明文で pin:
 * 「webhook は socket 経路 (message:send) のみ発火、REST は非発火」。
 * 4 箇所の同型実装 (MessageInput/FormBubble/ForwardModal/SharePage) を集約した契約の回帰網。
 *
 * ★ #537 (2026-10-09) つながっていないときも REST に回さない。つながり直すのを待って socket で送り、
 *   つながらなければ投げる。以前は REST に回して、配信もプッシュもアシスタントも動かない便が DB にだけ入った
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ★ #593 サーバは受け取りの返事 (ack) を返す。既定は「保存できた」を返す偽物
let ackReply: { ok: boolean; id?: string; error?: string } | null = { ok: true, id: 'new1' };
const emitMock = vi.fn((...a: unknown[]) => {
  const last = a[a.length - 1];
  if (typeof last === 'function' && ackReply) (last as (r: unknown) => void)(ackReply);
});
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
    emitMock.mockClear(); sendMessageMock.mockClear(); ackReply = { ok: true, id: 'new1' };
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
    expect(emitMock).toHaveBeenCalledWith('message:send', { room_id: 'r1', content: 'hi', reply_to: null, forwarded_from: 'src1' }, expect.any(Function));
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

  // ★ #593 サーバが断ったら理由で投げる (画面は入力欄の文を残して理由を出す)。以前は emit した時点で成功扱いだった
  it('★★ サーバが断ったら (ok: false) 理由で投げる', async () => {
    ackReply = { ok: false, error: 'このルームのメンバーではないため送れませんでした' };
    await expect(sendRoomMessage({ roomId: 'r1', content: 'hi' })).rejects.toThrow('このルームのメンバーではないため送れませんでした');
  });

  // ★ 2026-10-23 小野さん判断 (改善ループ 12 回目の B1): 返事が来ないのは「届いていない」と見る。
  //   以前は送れたとして扱い、電波の弱い所で入力欄の文が消えて相手に届かない、が黙って起きた (サーバは #593 から必ず返事する)
  it('★ 返事が来なければ失敗として投げる (呼び出し側が文を残して「もう一度」を出す)', async () => {
    ackReply = null;
    await expect(sendRoomMessage({ roomId: 'r1', content: 'hi' }, { ackWaitMs: 20 })).rejects.toThrow('届いたか確かめられませんでした');
  });
});

