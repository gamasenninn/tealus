/**
 * ある user の名義でルームに投稿する共通処理 (#382)
 *
 * ★ POST /api/bot/push が持っていた 4 つを切り出したもの。**新しい投稿経路ではない**
 *   (docs/06 §3.3)。トリガーは HTTP を経由せずこれを直接呼ぶので、認証を通す必要が消える。
 *
 * ```
 * 1. room_members 確認   ← 名義の妥当性検査。これが無いと他ルームへ勝手に書ける
 * 2. INSERT
 * 3. io.to(room).emit    ← 画面の更新 + 未読の数え直し (クライアントが message:new を合図に数え直す)
 * 4. fireWebhooks        ← ★ エージェントが起動する。抜けると機能そのものが動かない
 * ```
 *
 * ★★ sender は **context object で受け取る**。helper の中で users を引かない
 *   (docs/05 §4 の既存の約束。4 経路すべてがこの形で揃っている)。
 *   引くと helper がモジュール状態を持ち、テストが DB に結合する。
 *
 * ★★★ プッシュ通知は**付けない**。docs/06 §3.3 が「欠落ではなく仕様」と名指ししている。
 *   後から「LINE 経由と同じ抜け漏れだ」と判断して足さないこと。
 */
import { pool } from '../db/pool.mts';
import { getIo } from '../io-registry.mts';
import { fireWebhooks } from './webhook.mts';
import { logger } from '../utils/logger.mts';

/** 4 経路で共通の sender context (docs/05 §4) */
export interface SenderContext {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface PostAsUserInput {
  roomId: string;
  sender: SenderContext;
  content: string;
  type?: string;
}

export interface PostedMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  type: string;
  reply_to?: string | null;
}

export type PostAsUserResult =
  | { ok: true; message: PostedMessage }
  | { ok: false; code: 'empty_content' | 'not_member' | 'error'; reason: string };

export async function postAsUser(input: PostAsUserInput): Promise<PostAsUserResult> {
  const { roomId, sender, type = 'text' } = input;
  const content = input.content?.trim() ?? '';
  if (!content) return { ok: false, code: 'empty_content', reason: 'content が空です' };

  try {
    const member = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, sender.id],
    );
    if (member.rows.length === 0) {
      return { ok: false, code: 'not_member', reason: 'このルームのメンバーではありません' };
    }

    const inserted = await pool.query<PostedMessage>(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [roomId, sender.id, content, type],
    );
    const message = inserted.rows[0];

    getIo().to(roomId).emit('message:new', {
      ...message,
      sender_display_name: sender.display_name,
      sender_avatar_url: sender.avatar_url,
    });

    fireWebhooks('message.created', roomId, {
      room: { id: roomId },
      message: {
        id: message.id,
        type,
        content,
        reply_to: message.reply_to || null,
        sender: { id: sender.id, display_name: sender.display_name },
      },
    });

    return { ok: true, message };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(`postAsUser 失敗: room=${roomId} user=${sender.id} ${reason}`);
    return { ok: false, code: 'error', reason };
  }
}
