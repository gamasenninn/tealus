import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember } from '../middleware/roomAccess.mts';
import { isGuest } from '../utils/permissions.mts';
import { badIdMessage } from '../utils/uuid.mts';
import { isUuid } from '../utils/uuid.mts';
import { announceUnreadChanged } from '../services/unreadChanged.mts';

export const router = express.Router({ mergeParams: true });

router.use(authenticate);

/**
 * ★ #551 既読はお知らせの部屋ならメンバーでない人 (ゲストを除く) も付けられる。ホームのお知らせ (rooms.mts /announcements) と同じ決まり。
 *   以前はメンバーだけで、ホームで見ても 403 になり、未読の点が消えなかった (14 日で 57 件)。
 *   利用者の判断 (10-10): 部屋の「既読 N」にも数える。進められるのは公開された投稿の位置まで (res.locals.publishedOnly)
 */
async function requireMemberOrAnnouncementReader(req: Request, res: Response, next: () => void) {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: badIdMessage(String(req.params.id)) });
  if (!isGuest(req.user)) {
    try {
      const r = await pool.query(
        `SELECT 1 FROM rooms WHERE id = $1 AND is_announcement = true
           AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2)`,
        [req.params.id, req.user!.id]);
      if (r.rows.length > 0) { res.locals.publishedOnly = true; return next(); }
    } catch (err) {
      logger.error('Announcement read check error:', err);
      return res.status(500).json({ error: E.SERVER_ERROR });
    }
  }
  return requireMember(req, res, next);
}

/**
 * POST /api/rooms/:id/read
 * Mark messages as read (cursor-based).
 * Accepts message_ids array — advances cursor to the latest among them.
 */
router.post('/', requireMemberOrAnnouncementReader, async (req: Request, res: Response) => {
  const roomId = req.params.id;
  const userId = req.user!.id;
  const { message_ids } = req.body;

  if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
    return res.status(400).json({ error: 'message_idsは必須です' });
  }

  try {
    // ★ #483 この部屋のメッセージだけ (socket の message:read と同じ)。ID の形でないものは捨てる (500 にしない)
    const latestMsg = await pool.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at FROM messages
       WHERE id = ANY($1::uuid[]) AND room_id = $2
         AND ($3::boolean = false OR (is_published = true AND is_deleted = false))
       ORDER BY created_at DESC
       LIMIT 1`,
      [message_ids.filter(isUuid), roomId, Boolean(res.locals.publishedOnly)]
    );

    if (latestMsg.rows.length > 0) {
      await pool.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, $3, $4::timestamptz + interval '1 millisecond')
         ON CONFLICT (room_id, user_id)
         DO UPDATE SET
           last_read_message_id = CASE
             WHEN room_read_cursors.last_read_at < EXCLUDED.last_read_at
             THEN EXCLUDED.last_read_message_id
             ELSE room_read_cursors.last_read_message_id
           END,
           last_read_at = GREATEST(room_read_cursors.last_read_at, EXCLUDED.last_read_at)`,
        [roomId, userId, latestMsg.rows[0].id, latestMsg.rows[0].created_at]
      );
    }

    announceUnreadChanged(userId, String(roomId));   // ★ #532
    res.json({ success: true });
  } catch (err) {
    logger.error('Mark read error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms/:id/read/all
 * Mark all messages in the room as read.
 */
router.post('/all', requireMember, async (req: Request, res: Response) => {
  const roomId = req.params.id;
  const userId = req.user!.id;

  try {
    // Count current unread
    const unreadRes = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM messages m
       WHERE m.room_id = $1
         AND m.sender_id != $2
         AND m.is_deleted = false
         AND m.created_at > COALESCE(
           (SELECT last_read_at FROM room_read_cursors WHERE room_id = $1 AND user_id = $2),
           '1970-01-01'
         )`,
      [roomId, userId]
    );

    // Advance cursor to the latest message
    const latest = await pool.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at FROM messages
       WHERE room_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [roomId]
    );

    if (latest.rows.length > 0) {
      await pool.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, $3, $4::timestamptz + interval '1 millisecond')
         ON CONFLICT (room_id, user_id)
         -- ★ #553 ほかの 3 つの口と同じく新しいほうを残す (別の端末がより先まで読んでいたら戻さない)
         DO UPDATE SET
           last_read_message_id = CASE
             WHEN room_read_cursors.last_read_at < EXCLUDED.last_read_at
             THEN EXCLUDED.last_read_message_id
             ELSE room_read_cursors.last_read_message_id
           END,
           last_read_at = GREATEST(room_read_cursors.last_read_at, EXCLUDED.last_read_at)`,
        [roomId, userId, latest.rows[0].id, latest.rows[0].created_at]
      );
    }

    const count = unreadRes.rows[0].count;
    logger.info(`Mark all read: ${userId} in room ${roomId} (${count} messages)`);
    announceUnreadChanged(userId, String(roomId));   // ★ #532
    res.json({ success: true, count });
  } catch (err) {
    logger.error('Mark all read error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
