import { getIo } from '../io-registry.mts';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember } from '../middleware/roomAccess.mts';
import { MESSAGES_DEFAULT_LIMIT, MESSAGES_MAX_LIMIT } from '../constants/config.mts';
import { attachMedia, attachReplies, attachForwards, attachTranscriptions, attachLinkPreviews, attachReactions, attachTags, attachStamps, type AttachableMessage } from '../services/messageAttachments.mts';
import { fireWebhooks } from '../services/webhook.mts';
import { isUuid, badIdMessage } from '../utils/uuid.mts';
import { checkMessageRefs } from '../services/messageRefs.mts';
import { announcePost } from '../services/postEffects.mts';

export const router = express.Router({ mergeParams: true });

/** messages テーブル行 (m.* / RETURNING *。attach 系に渡すので AttachableMessage を拡張) */
interface MessageRow extends AttachableMessage {
  room_id: string;
  sender_id: string;
  created_at: Date;
  is_deleted: boolean;
}

router.use(authenticate, requireMember);

// ★ 形の崩れたメッセージ ID には 500 でなく 400 と理由を返す (2026-10-01、#477 と同じ決まり)
router.param('msgId', (_req, res, next, msgId: string) => {
  if (!isUuid(msgId)) return res.status(400).json({ error: badIdMessage(msgId) });
  next();
});

/**
 * メッセージが URL の部屋のものか (2026-09-30)。
 * ★ requireMember は「URL の部屋のメンバーか」しか見ない。:msgId の口は、これで別の部屋のメッセージを弾く
 */
async function isMessageInRoom(msgId: unknown, roomId: string): Promise<boolean> {
  if (!isUuid(msgId)) return false;
  const r = await pool.query('SELECT 1 FROM messages WHERE id = $1 AND room_id = $2', [msgId, roomId]);
  return r.rows.length > 0;
}

/**
 * POST /api/rooms/:id/messages
 * Send a message to a room
 */
router.post('/', async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const userId = req.user!.id;
  const { content, type = 'text', reply_to, forwarded_from } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'メッセージ内容は必須です' });
  }

  try {
    // ★ #482 返信先・転送元は指してよい投稿だけ
    const refs = await checkMessageRefs({ roomId, userId, replyTo: reply_to, forwardedFrom: forwarded_from });
    if (!refs.ok) return res.status(refs.status).json({ error: refs.error });

    const result = await pool.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to, forwarded_from)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [roomId, userId, content.trim(), type, reply_to || null, forwarded_from || null]
    );

    const message = result.rows[0];

    // ★ スタンプ (#9') は配信 + 人の通知 (#383、2026-10-02 利用者判断)。画面はスタンプをこの口で送るが、
    //   配信が無く、送った本人の画面にしか出なかった。中身は __tests__/socket/stampSendPayload で固定
    // ★ スタンプ以外 (REST のテキスト) は今までどおり何も付けない (#9 は触らない、利用者判断)
    if (type === 'stamp') {
      const emitted: AttachableMessage = { ...message, sender_display_name: req.user!.display_name, sender_avatar_url: req.user!.avatar_url };
      await attachStamps([emitted]);
      await announcePost({
        roomId,
        emit: emitted as unknown as Record<string, unknown>,
        push: { kind: 'human', senderId: userId, payload: { title: req.user!.display_name, body: '🙂 スタンプ', data: { roomId, messageId: message.id } } },
        webhook: { kind: 'off', reason: '意図 (docs/07 §3.1、2026-10-02 利用者判断)。スタンプで AI は動かさない' },
        preview: { kind: 'off', reason: '意図。スタンプに URL の本文は無い (content はスタンプの ID)' },
      });
    }

    // Update per-user stamp usage
    if (type === 'stamp' && content) {
      pool.query(
        `INSERT INTO user_stamp_usage (user_id, pack_id, last_used_at)
         VALUES ($1, (SELECT pack_id FROM stamps WHERE id = $2), NOW())
         ON CONFLICT (user_id, pack_id) DO UPDATE SET last_used_at = NOW()`,
        [userId, content.trim()]
      ).catch(() => {});
    }

    res.status(201).json({ message });
  } catch (err) {
    logger.error('Send message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/messages
 * Get message history with cursor-based pagination
 */
router.get('/', async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const { before, around, limit = MESSAGES_DEFAULT_LIMIT } = req.query;
  const parsedLimit = Math.min(Math.max(parseInt(String(limit)) || MESSAGES_DEFAULT_LIMIT, 1), MESSAGES_MAX_LIMIT);
  // ★ #483 基準のメッセージは ID の形を確かめる (崩れていると 500 だった)。部屋の外のものは下の SQL で「無いもの」と同じになる
  for (const cursorId of [around, before]) {
    if (cursorId !== undefined && !isUuid(cursorId)) return res.status(400).json({ error: badIdMessage(String(cursorId)) });
  }

  try {
    let query: string;
    let params: unknown[];

    if (around) {
      // Get messages around a specific message (for search jump)
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
        ) rc ON true
        WHERE m.room_id = $1
          AND m.created_at >= (SELECT created_at FROM messages WHERE id = $2 AND room_id = $1) - INTERVAL '1 second'
        ORDER BY m.created_at ASC
        LIMIT $3
      `;
      params = [roomId, around, parsedLimit];
    } else if (before) {
      // Get the created_at of the cursor message
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
        ) rc ON true
        WHERE m.room_id = $1
          AND m.created_at < (SELECT created_at FROM messages WHERE id = $2 AND room_id = $1)
        ORDER BY m.created_at DESC
        LIMIT $3
      `;
      params = [roomId, before, parsedLimit];
    } else {
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
        ) rc ON true
        WHERE m.room_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `;
      params = [roomId, parsedLimit];
    }

    const result = await pool.query<MessageRow>(query, params);
    const messages = result.rows;

    // Attach related data
    await attachMedia(messages);
    await attachReplies(messages);
    await attachForwards(messages);
    await attachTranscriptions(messages);
    await attachLinkPreviews(messages);
    await attachReactions(messages, req.user!.id);
    await attachTags(messages);
    await attachStamps(messages);

    res.json({ messages });
  } catch (err) {
    logger.error('Get messages error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PATCH /api/rooms/:id/messages/:msgId/publish
 * Toggle publish status for announcement messages
 */
router.patch('/:msgId/publish', async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const { msgId } = req.params;
  const userId = req.user!.id;
  const { is_published } = req.body;

  try {
    // Check room is announcement
    const roomResult = await pool.query<{ is_announcement: boolean }>(
      'SELECT is_announcement FROM rooms WHERE id = $1',
      [roomId]
    );
    if (!roomResult.rows[0]?.is_announcement) {
      return res.status(400).json({ error: 'お知らせルームのみ操作可能です' });
    }

    // Check message exists
    const msgResult = await pool.query<{ sender_id: string; is_deleted: boolean }>(
      'SELECT sender_id, is_deleted FROM messages WHERE id = $1 AND room_id = $2',
      [msgId, roomId]
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }
    if (msgResult.rows[0].is_deleted) {
      return res.status(400).json({ error: '削除済みメッセージは操作できません' });
    }

    // Permission: sender or room admin
    const isOwner = msgResult.rows[0].sender_id === userId;
    if (!isOwner) {
      const adminCheck = await pool.query(
        "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 AND role = 'admin'",
        [roomId, userId]
      );
      if (adminCheck.rows.length === 0) {
        return res.status(403).json({ error: '送信者またはグループ管理者のみ操作できます' });
      }
    }

    const result = await pool.query<{ id: string; is_published: boolean }>(
      'UPDATE messages SET is_published = $1 WHERE id = $2 RETURNING id, is_published',
      [is_published, msgId]
    );

    // Socket.IO broadcast
    const io = getIo();
    io.to(roomId).emit('message:published', { message_id: msgId, is_published });

    res.json({ message: result.rows[0] });
  } catch (err) {
    logger.error('Publish toggle error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// --- #476 日付へ飛ぶ -------------------------------------------------------
// ★ tz_offset は画面の Date.getTimezoneOffset() (UTC − 現地、分。日本なら -540)。
//   日の区切りを見ている人の時刻に合わせる。現地の 0 時 = UTC の (0 時 + tz_offset 分)

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** tz_offset を分の整数で読む。時差は ±14 時間まで。読めなければ null */
function parseTzOffset(v: unknown): number | null {
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return null;
  const n = parseInt(v, 10);
  return Math.abs(n) <= 14 * 60 ? n : null;
}

/** 現地の y/m/d 0 時を UTC の Date にする */
function localMidnightUtc(y: number, m: number, d: number, tzOffset: number): Date {
  return new Date(Date.UTC(y, m - 1, d) + tzOffset * 60_000);
}

/**
 * GET /api/rooms/:id/messages/days?month=YYYY-MM&tz_offset=分
 * その月で投稿がある日 (見ている人の時刻で) — カレンダーの印に使う
 */
router.get('/days', async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const m = MONTH_RE.exec(String(req.query.month ?? ''));
  const tz = parseTzOffset(req.query.tz_offset);
  if (!m || tz === null) return res.status(400).json({ error: 'month (YYYY-MM) と tz_offset (分) が必要です' });

  const y = Number(m[1]), mo = Number(m[2]);
  const from = localMidnightUtc(y, mo, 1, tz);
  const to = localMidnightUtc(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1, tz);
  try {
    const r = await pool.query<{ d: string }>(
      `SELECT DISTINCT to_char((created_at AT TIME ZONE 'UTC') - ($2::int * INTERVAL '1 minute'), 'YYYY-MM-DD') AS d
         FROM messages
        WHERE room_id = $1 AND is_deleted = false AND created_at >= $3 AND created_at < $4
        ORDER BY d`,
      [roomId, tz, from, to],
    );
    res.json({ days: r.rows.map((row) => row.d) });
  } catch (err) {
    logger.error('Message days error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/messages/first-of-day?date=YYYY-MM-DD&tz_offset=分
 * その日の最初の投稿 (消したものは数えない)。無ければ message_id: null
 */
router.get('/first-of-day', async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const d = DATE_RE.exec(String(req.query.date ?? ''));
  const tz = parseTzOffset(req.query.tz_offset);
  if (!d || tz === null) return res.status(400).json({ error: 'date (YYYY-MM-DD) と tz_offset (分) が必要です' });

  const y = Number(d[1]), mo = Number(d[2]), day = Number(d[3]);
  // ★ 2/30 のような無い日は 3/2 に化けるので、組み立て直して同じかを確かめる
  const check = new Date(Date.UTC(y, mo - 1, day));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) {
    return res.status(400).json({ error: 'date が正しい日付ではありません' });
  }
  const from = localMidnightUtc(y, mo, day, tz);
  const to = new Date(from.getTime() + 86_400_000);
  try {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM messages
        WHERE room_id = $1 AND is_deleted = false AND created_at >= $2 AND created_at < $3
        ORDER BY created_at ASC LIMIT 1`,
      [roomId, from, to],
    );
    res.json({ message_id: r.rows[0]?.id ?? null });
  } catch (err) {
    logger.error('First of day error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/rooms/:id/messages/:msgId
 * Edit message content (policy-based: none/sender/member)
 */
router.put('/:msgId', async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const { msgId } = req.params;
  const userId = req.user!.id;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'メッセージ内容は必須です' });
  }

  try {
    // Get message and room policy
    const msgResult = await pool.query<{
      sender_id: string;
      content: string | null;
      type: string;
      is_deleted: boolean;
      message_edit_policy: string;
    }>(
      `SELECT m.sender_id, m.content, m.type, m.is_deleted, r.message_edit_policy
       FROM messages m JOIN rooms r ON r.id = m.room_id
       WHERE m.id = $1 AND m.room_id = $2`,
      [msgId, roomId]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const msg = msgResult.rows[0];

    if (msg.is_deleted) {
      return res.status(400).json({ error: '削除済みメッセージは編集できません' });
    }

    if (msg.type === 'system' || msg.type === 'stamp') {
      return res.status(400).json({ error: 'このメッセージは編集できません' });
    }

    // 初回キャプション追加（contentがnullかつ送信者本人）は常に許可
    const isFirstCaption = !msg.content && msg.sender_id === userId;

    if (!isFirstCaption) {
      if (msg.message_edit_policy === 'none') {
        return res.status(403).json({ error: 'このルームではメッセージ編集が許可されていません' });
      }

      if (msg.message_edit_policy === 'sender' && msg.sender_id !== userId) {
        return res.status(403).json({ error: '送信者のみ編集できます' });
      }

      if (msg.message_edit_policy === 'member') {
        const memberCheck = await pool.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, userId]
        );
        if (memberCheck.rows.length === 0) {
          return res.status(403).json({ error: 'ルームメンバーのみ編集できます' });
        }
      }
    }

    // Save current content to edit history (skip if first caption - no previous content)
    let newVersion = 0;
    if (msg.content) {
      const versionResult = await pool.query<{ next: number }>(
        'SELECT COALESCE(MAX(version), 0) + 1 as next FROM message_edits WHERE message_id = $1',
        [msgId]
      );
      newVersion = versionResult.rows[0].next;

      await pool.query(
        'INSERT INTO message_edits (message_id, version, content, edited_by) VALUES ($1, $2, $3, $4)',
        [msgId, newVersion, msg.content, userId]
      );
    }

    // Update message
    const updateResult = await pool.query<MessageRow>(
      'UPDATE messages SET content = $1, is_edited = true, updated_at = now() WHERE id = $2 RETURNING *',
      [content.trim(), msgId]
    );

    // Socket.IO broadcast
    const io = getIo();
    io.to(roomId).emit('message:updated', {
      message_id: msgId,
      content: content.trim(),
      is_edited: true,
      edited_by: userId,
      edited_by_name: req.user!.display_name,
    });

    // Webhook
    fireWebhooks('message.updated', roomId, {
      room: { id: roomId },
      message: {
        id: msgId,
        content: content.trim(),
        previous_content: msg.content,
        version: newVersion,
        sender: { id: msg.sender_id },
        edited_by: { id: userId, display_name: req.user!.display_name },
      },
    });

    res.json({ message: updateResult.rows[0] });
  } catch (err) {
    logger.error('Edit message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/messages/:msgId/edits
 * Get message edit history
 */
router.get('/:msgId/edits', async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const { msgId } = req.params;
  const userId = req.user!.id;

  try {
    // Check room member
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'ルームメンバーのみ閲覧できます' });
    }
    // ★ この部屋のメッセージだけ (以前は別の部屋の投稿の前の文面も読めた)
    if (!(await isMessageInRoom(msgId, roomId))) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const result = await pool.query(
      `SELECT me.version, me.content, me.edited_by, me.created_at, u.display_name AS edited_by_name
       FROM message_edits me
       LEFT JOIN users u ON u.id = me.edited_by
       WHERE me.message_id = $1
       ORDER BY me.version DESC`,
      [msgId]
    );

    res.json({ edits: result.rows });
  } catch (err) {
    logger.error('Get message edits error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/rooms/:id/messages/:msgId
 * Soft-delete a message (sender only)
 */
router.delete('/:msgId', async (req: Request, res: Response) => {
  const { msgId } = req.params;
  const userId = req.user!.id;

  try {
    const msg = await pool.query<{ sender_id: string; room_id: string }>(
      'SELECT sender_id, room_id FROM messages WHERE id = $1',
      [msgId]
    );
    // ★ URL の部屋のメッセージだけ (以前は別の部屋の URL でも消せ、削除の知らせを違う部屋へ流していた)
    if (msg.rows.length === 0 || msg.rows[0].room_id !== (req.params as { id: string }).id) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }
    if (msg.rows[0].sender_id !== userId) {
      return res.status(403).json({ error: '自分のメッセージのみ削除できます' });
    }

    await pool.query(
      'UPDATE messages SET is_deleted = true, content = null, updated_at = now() WHERE id = $1',
      [msgId]
    );

    const io = getIo();
    const roomId = (req.params as { id: string }).id;
    io.to(roomId).emit('message:deleted', { message_id: msgId });

    // Webhook notification
    fireWebhooks('message.deleted', roomId, {
      room: { id: roomId },
      message: { id: msgId, sender: { id: userId, display_name: req.user!.display_name } },
    });

    res.json({ message: '削除しました' });
  } catch (err) {
    logger.error('Delete message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms/:id/messages/:msgId/reactions
 * Toggle a reaction (add or remove)
 */
router.post('/:msgId/reactions', async (req: Request, res: Response) => {
  const { msgId } = req.params;
  const userId = req.user!.id;
  const { emoji } = req.body;

  if (!emoji) {
    return res.status(400).json({ error: 'emoji は必須です' });
  }

  try {
    // ★ この部屋のメッセージだけ (以前は別の部屋の投稿にも付け外しできた。✅ は「処理済み」の印にも使われている)
    const roomId = (req.params as { id: string }).id;
    if (!(await isMessageInRoom(msgId, roomId))) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    // Check if already reacted
    const existing = await pool.query(
      'SELECT 1 FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [msgId, userId, emoji]
    );

    if (existing.rows.length > 0) {
      // Remove
      await pool.query(
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
        [msgId, userId, emoji]
      );
    } else {
      // Add
      await pool.query(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)',
        [msgId, userId, emoji]
      );
    }

    // Get updated reactions for this message
    const reactions = await pool.query<{ emoji: string; count: number; me: boolean }>(
      `SELECT emoji, COUNT(*)::int as count,
              BOOL_OR(user_id = $2) as me
       FROM message_reactions WHERE message_id = $1
       GROUP BY emoji ORDER BY MIN(created_at)`,
      [msgId, userId]
    );

    const io = getIo();
    io.to(roomId).emit('message:reaction', {
      message_id: msgId,
      reactions: reactions.rows,
    });

    // Webhook notification (追加時のみ)
    if (existing.rows.length === 0) {
      fireWebhooks('reaction.added', roomId, {
        room: { id: roomId },
        message: { id: msgId },
        reaction: { emoji, user: { id: userId, display_name: req.user!.display_name } },
      });
    }

    res.json({ reactions: reactions.rows });
  } catch (err) {
    logger.error('Reaction error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
