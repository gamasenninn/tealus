import { getSocket } from './socket';

/**
 * 部屋へテキストメッセージを送る唯一の経路 (#341後リファクタで 4 箇所の同型実装を集約)。
 *
 * ★ docs/05 §4 不変条件: `message.created` webhook は **socket 経路 (`message:send`) のみ** 発火する。
 *   REST (`api.sendMessage`) は webhook を発火しないため、cc-queue / LINE 等の consumer が起動しない。
 *   → 新しいテキストは必ず socket で送る (切れていればつながり直すのを待つ、#537)。この判断を 1 箇所に閉じ込め、
 *   送信 UI を増やすたびに #336 (FormBubble が REST 送信で cc-queue 不起動) を再発させない。
 *
 * ★ #537 以降は REST に回さない (つながり直すのを待ち、つながらなければ投げる)。戻り値は常に 'socket'。
 *
 * server 側 (`socket/handlers/message.mts`, `routes/messages.mts`) は `reply_to`/`forwarded_from` を
 * `|| null` で受けるため、未指定キーは null と等価。`type` は既定 `'text'`。よって両フィールドを常に
 * null 込みで送る本契約は、集約前 4 箇所 (MessageInput / FormBubble / ForwardModal / SharePage) の
 * 各ペイロードと振る舞い等価。content の trim は各呼び出し側の責務 (server も content.trim() する)。
 */
export interface SendRoomMessageOpts {
  roomId: string;
  content: string;
  replyTo?: string | null;
  forwardedFrom?: string | null;
}

/** ★ #537 つながっていないとき、つながり直すのを待つ長さ (再接続は 1〜5 秒ごとに試みる) */
export const SEND_RECONNECT_WAIT_MS = 10_000;

/** つながっていれば即、いなければ connect を待つ。待っても来なければ false */
function waitForConnection(waitMs: number): Promise<boolean> {
  const socket = getSocket();
  if (!socket) return new Promise((r) => setTimeout(() => r(!!getSocket()?.connected), waitMs));
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onConnect = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { socket.off('connect', onConnect); resolve(false); }, waitMs);
    socket.once('connect', onConnect);
  });
}

export async function sendRoomMessage({
  roomId,
  content,
  replyTo = null,
  forwardedFrom = null,
}: SendRoomMessageOpts, { waitMs = SEND_RECONNECT_WAIT_MS }: { waitMs?: number } = {}): Promise<'socket'> {
  // ★ #537 つながっていなければ REST に回さず、つながり直すのを待つ。REST の口は配らないので、
  //   以前はつなぎ直しの数秒に送った便が、配信もプッシュもアシスタントも動かないまま DB にだけ入った
  if (!(await waitForConnection(waitMs))) {
    throw new Error('つながっていないため送れませんでした。電波を確かめて、もう一度送ってください');
  }
  getSocket()!.emit('message:send', {
    room_id: roomId,
    content,
    reply_to: replyTo,
    forwarded_from: forwardedFrom,
  });
  return 'socket';
}
