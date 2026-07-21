import { getSocket } from './socket';
import { api } from './api';

/**
 * 部屋へテキストメッセージを送る唯一の経路 (#341後リファクタで 4 箇所の同型実装を集約)。
 *
 * ★ docs/05 §4 不変条件: `message.created` webhook は **socket 経路 (`message:send`) のみ** 発火する。
 *   REST (`api.sendMessage`) は webhook を発火しないため、cc-queue / LINE 等の consumer が起動しない。
 *   → socket 接続時は必ず socket を優先し、切断時のみ REST に fallback する。この判断を 1 箇所に閉じ込め、
 *   送信 UI を増やすたびに #336 (FormBubble が REST 送信で cc-queue 不起動) を再発させない。
 *
 * 戻り値 `'socket' | 'rest'` で、呼び出し側は REST 時のみ必要な補償 (例: FormBubble の `fetchMessages`) を行える。
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

export async function sendRoomMessage({
  roomId,
  content,
  replyTo = null,
  forwardedFrom = null,
}: SendRoomMessageOpts): Promise<'socket' | 'rest'> {
  const socket = getSocket();
  if (socket?.connected) {
    socket.emit('message:send', {
      room_id: roomId,
      content,
      reply_to: replyTo,
      forwarded_from: forwardedFrom,
    });
    return 'socket';
  }
  await api.sendMessage(roomId, content, replyTo, forwardedFrom);
  return 'rest';
}
