import type { Socket, Server } from 'socket.io';
import { logger } from '../../utils/logger.mts';
import { pool } from '../../db/pool.mts';
import { isUuid } from '../../utils/uuid.mts';
import { announcePost } from '../../services/postEffects.mts';
import { checkMessageRefs } from '../../services/messageRefs.mts';
import { SOCKET_POST_TYPES } from '../../services/messageTypes.mts';
import { REPLY_SELECT, normalizeReply, type ReplyMessageRow } from '../../services/messageAttachments.mts';

interface ForwardMessageRow extends ReplyMessageRow {
  room_name: string | null;
  room_type: string;
}

interface SendPayload {
  room_id?: string;
  content?: string;
  type?: string;
  reply_to?: string | null;
  forwarded_from?: string | null;
}

/**
 * Fetch reply_to message info with transcription fallback
 */
export async function fetchReplyMessage(replyToId: string): Promise<ReplyMessageRow | null> {
  const result = await pool.query<ReplyMessageRow>(
    `SELECT ${REPLY_SELECT}
     FROM messages m JOIN users u ON u.id = m.sender_id
     LEFT JOIN LATERAL (
       SELECT formatted_text, raw_text FROM voice_transcriptions
       WHERE message_id = m.id ORDER BY version DESC LIMIT 1
     ) vt ON m.type = 'voice'
     WHERE m.id = $1`,
    [replyToId]
  );
  if (result.rows.length === 0) return null;
  // ★ #501 削除済みの空欄化・音声の文字起こしは attachReplies と同じ関数で (2 か所に持たない)
  return normalizeReply(result.rows[0]);
}

/**
 * Fetch forwarded_from message info (#166) — includes room_name
 * Excludes deleted messages (returns null).
 */
export async function fetchForwardMessage(forwardId: string): Promise<ForwardMessageRow | null> {
  const result = await pool.query<ForwardMessageRow>(
    `SELECT m.id, m.content, m.type, m.sender_id, m.is_deleted,
            u.display_name AS sender_display_name,
            r.name AS room_name, r.type AS room_type,
            vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     JOIN rooms r ON r.id = m.room_id
     LEFT JOIN LATERAL (
       SELECT formatted_text, raw_text FROM voice_transcriptions
       WHERE message_id = m.id ORDER BY version DESC LIMIT 1
     ) vt ON m.type = 'voice'
     WHERE m.id = $1 AND m.is_deleted = false`,
    [forwardId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  if (r.type === 'voice' && !r.content) {
    r.content = r.transcription_text || r.transcription_raw || null;
  }
  return r;
}

/**
 * Handle message:send event
 */
export function registerMessageHandler(socket: Socket, io: Server): void {
  socket.on('message:send', async (data: SendPayload) => {
    // ★ 値の形を入口で確かめる (2026-10-01、部外者の総当たりで null / 崩れた ID が例外になっていた)
    if (!data || typeof data !== 'object') return;
    const { room_id, content, type = 'text', reply_to, forwarded_from } = data;
    logger.debug(`message:send user=${socket.user.id} room=${room_id} type=${type}`);

    if (!isUuid(room_id) || typeof content !== 'string' || content.trim() === '') return;
    // ★ 画面からの投稿は text だけ (2026-10-02、services/messageTypes.mts)。system や form を名乗れない
    if (!SOCKET_POST_TYPES.includes(type)) {
      logger.warn(`message:send を断りました (type=${String(type).slice(0, 30)}): actor=${socket.user.display_name}(${socket.user.id}) room=${room_id}`);
      return;
    }

    // Verify membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, socket.user.id]
    );
    if (memberCheck.rows.length === 0) return;

    // ★ #482 返信先・転送元は指してよい投稿だけ。満たさなければ投稿ごと断る (メンバーでないときと同じく黙って返す)
    const refs = await checkMessageRefs({ roomId: room_id, userId: socket.user.id, replyTo: reply_to, forwardedFrom: forwarded_from });
    if (!refs.ok) {
      logger.warn(`message:send を断りました (#482 ${refs.error}): actor=${socket.user.display_name}(${socket.user.id}) room=${room_id}`);
      return;
    }

    try {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO messages (room_id, sender_id, content, type, reply_to, forwarded_from)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [room_id, socket.user.id, content.trim(), type, reply_to || null, forwarded_from || null]
      );

      const message = {
        ...result.rows[0],
        sender_display_name: socket.user.display_name,
        sender_avatar_url: socket.user.avatar_url,
        reply_to_message: reply_to ? await fetchReplyMessage(reply_to) : null,
        forwarded_from_message: forwarded_from ? await fetchForwardMessage(forwarded_from) : null,
      };

      // ★ 付随処理 4 つは announcePost から (#383 段階 1、docs/07 §5.1)。中身は __tests__/socket/messageSendPayload で固定
      // ★ 通知とプレビューは空白を落とす前の本文、配信 (DB) と AI 通知は落とした後の本文 (移す前と同じ)
      await announcePost({
        roomId: room_id,
        emit: message,
        push: {
          kind: 'human',
          senderId: socket.user.id,
          payload: {
            title: socket.user.display_name,
            body: content.slice(0, 100) || (type === 'voice' ? '🎤 音声メッセージ' : '📎 ファイル'),
            data: { roomId: room_id, messageId: message.id },
          },
        },
        webhook: {
          kind: 'on',
          payload: {
            room: { id: room_id },
            message: { id: message.id, type, content: content.trim(), reply_to: reply_to || null, reply_to_message: message.reply_to_message || null, sender: { id: socket.user.id, display_name: socket.user.display_name } },
          },
        },
        preview: type === 'text'
          ? { kind: 'on', messageId: message.id, text: content }
          : { kind: 'off', reason: 'text 以外 (移す前と同じ。プレビューは text だけ)' },
      });
    } catch (err) {
      logger.error('Socket message:send error:', err);
    }
  });
}
