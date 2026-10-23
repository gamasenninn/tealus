import { getSocket } from './socket';

/**
 * 部屋へテキストメッセージを送る唯一の経路 (#341後リファクタで 4 箇所の同型実装を集約)。
 *
 * ★ docs/05 §4 不変条件: `message.created` webhook は **socket 経路 (`message:send`) のみ** 発火する。
 *   REST (`POST /rooms/:id/messages`) は webhook を発火しないため、cc-queue / LINE 等の consumer が起動しない。
 *   ★ 画面側の REST 送信の関数 (api.sendMessage) は #575 で消した (#537 以降、呼び手 0)。足し直さないこと
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

/** ★ #593 サーバの受け取りの返事 (ack) を待つ長さ。★ 来なければ失敗として投げる (2026-10-23 小野さん判断) */
export const SEND_ACK_WAIT_MS = 10_000;

type SendAck = { ok: boolean; id?: string; error?: string };

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
}: SendRoomMessageOpts, { waitMs = SEND_RECONNECT_WAIT_MS, ackWaitMs = SEND_ACK_WAIT_MS }: { waitMs?: number; ackWaitMs?: number } = {}): Promise<'socket'> {
  // ★ #537 つながっていなければ REST に回さず、つながり直すのを待つ。REST の口は配らないので、
  //   以前はつなぎ直しの数秒に送った便が、配信もプッシュもアシスタントも動かないまま DB にだけ入った
  if (!(await waitForConnection(waitMs))) {
    throw new Error('つながっていないため送れませんでした。電波を確かめて、もう一度送ってください');
  }
  // ★ #593 サーバの受け取りの返事を待つ。断られたら理由で投げる (呼び出し側は入力欄の文を残して理由を出す)。
  //   以前は emit した時点で成功扱いで、メンバーでない部屋などへの便が黙って捨てられ、入力欄の文も消えていた
  const ack = await new Promise<SendAck | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ackWaitMs);
    getSocket()!.emit('message:send', {
      room_id: roomId,
      content,
      reply_to: replyTo,
      forwarded_from: forwardedFrom,
    }, (res: SendAck) => { clearTimeout(timer); resolve(res); });
  });
  // ★ 2026-10-23 小野さん判断: 返事が来ないのは「届いていない」と見て投げる (入力欄の文は呼び出し側が残す)。
  //   以前は古いサーバのために送れたとして扱い、電波の弱い所で文が消えて相手に届かない、が黙って起きた。
  //   まれに保存済みで返事だけ失われることがあるので、文言で「画面に出ていなければ」と添える (二重を防ぐ)
  if (!ack) throw new Error('届いたか確かめられませんでした。画面に出ていなければ、もう一度送ってください');
  if (!ack.ok) throw new Error(ack.error || '送れませんでした。もう一度お試しください');
  return 'socket';
}
