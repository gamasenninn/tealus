import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember } from '../middleware/roomAccess.mts';

/** tags テーブル行 (SELECT * / RETURNING *。アクセスする列のみ型付け) */
interface TagRow {
  id: string;
  name: string;
  is_todo: boolean;
  [key: string]: unknown;
}

/** タグ + 使用回数 (usage_count 集計付き一覧) */
interface TagWithUsageRow extends TagRow {
  usage_count: number;
}

// ============================================
// Room-scoped tag routes: /api/rooms/:id/tags
// ============================================
export const roomRouter = express.Router({ mergeParams: true });
roomRouter.use(authenticate);
roomRouter.use(requireMember);

/**
 * POST /api/rooms/:id/tags
 * Create a tag in a room (or return existing)
 */
roomRouter.post('/', async (req, res) => {
  const roomId = (req.params as { id: string }).id;
  const userId = req.user!.id;
  const { name, is_todo } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'タグ名は必須です' });
  }

  const trimmed = name.trim();

  try {
    // Check if tag already exists
    const existing = await pool.query<TagRow>(
      'SELECT * FROM tags WHERE room_id = $1 AND name = $2',
      [roomId, trimmed]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({ tag: existing.rows[0] });
    }

    const result = await pool.query<TagRow>(
      `INSERT INTO tags (room_id, name, is_todo, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [roomId, trimmed, is_todo || false, userId]
    );

    logger.info(`Tag created: "${trimmed}" in room ${roomId}`);
    res.status(201).json({ tag: result.rows[0] });
  } catch (err) {
    logger.error('Tag create error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/tags
 * List tags in a room with usage count
 */
roomRouter.get('/', async (req, res) => {
  const roomId = (req.params as { id: string }).id;

  try {
    const result = await pool.query<TagWithUsageRow>(
      `SELECT t.*, COUNT(mt.message_id)::int AS usage_count
       FROM tags t
       LEFT JOIN message_tags mt ON mt.tag_id = t.id
       WHERE t.room_id = $1
       GROUP BY t.id
       ORDER BY usage_count DESC, t.created_at DESC`,
      [roomId]
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('Tag list error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/rooms/:id/tags/:tagId
 * Delete a tag from the room. message_tags は FK ON DELETE CASCADE で自動除去される
 * （使用中タグでも削除可＝カスケード）。
 */
roomRouter.delete('/:tagId', async (req, res) => {
  const roomId = (req.params as { id: string; tagId: string }).id;
  const tagId = (req.params as { id: string; tagId: string }).tagId;

  try {
    const result = await pool.query(
      'DELETE FROM tags WHERE id = $1 AND room_id = $2',
      [tagId, roomId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'タグが見つかりません' });
    }

    logger.info(`Tag deleted: ${tagId} from room ${roomId}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Tag delete error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/tags/suggest?q=prefix
 * Suggest tags by prefix match
 */
roomRouter.get('/suggest', async (req, res) => {
  const roomId = (req.params as { id: string }).id;
  const { q } = req.query;

  if (!q) {
    return res.json({ tags: [] });
  }

  try {
    const result = await pool.query<TagWithUsageRow>(
      `SELECT t.*, COUNT(mt.message_id)::int AS usage_count
       FROM tags t
       LEFT JOIN message_tags mt ON mt.tag_id = t.id
       WHERE t.room_id = $1 AND t.name LIKE $2
       GROUP BY t.id
       ORDER BY usage_count DESC
       LIMIT 10`,
      [roomId, String(q) + '%']
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('Tag suggest error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/rooms/:id/tags/todo
 * List TODO tags in a room (is_todo = true)
 */
roomRouter.get('/todo', async (req, res) => {
  const roomId = (req.params as { id: string }).id;

  try {
    const result = await pool.query<TagWithUsageRow>(
      `SELECT t.*, COUNT(mt.message_id)::int AS usage_count
       FROM tags t
       LEFT JOIN message_tags mt ON mt.tag_id = t.id
       WHERE t.room_id = $1 AND t.is_todo = true
       GROUP BY t.id
       ORDER BY t.name`,
      [roomId]
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('TODO tag list error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// ============================================
// Message-scoped tag routes: /api/messages/:id/tags
// ============================================
export const messageRouter = express.Router({ mergeParams: true });
messageRouter.use(authenticate);

/**
 * Middleware: check message exists and user is room member
 */
async function requireMessageAccess(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const messageId = (req.params as { id: string }).id;
  const userId = req.user!.id;

  try {
    const msg = await pool.query<{ room_id: string }>(
      'SELECT m.room_id FROM messages m WHERE m.id = $1',
      [messageId]
    );
    if (msg.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const roomId = msg.rows[0].room_id;
    const member = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: E.ROOM_ACCESS_DENIED });
    }

    req.messageRoomId = roomId;
    next();
  } catch (err) {
    logger.error('Message access check error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
}

messageRouter.use(requireMessageAccess);

/**
 * POST /api/messages/:id/tags
 * Add a tag to a message (by tag_id or by name)
 */
messageRouter.post('/', async (req, res) => {
  const messageId = (req.params as { id: string }).id;
  const roomId = req.messageRoomId;
  const userId = req.user!.id;
  const { tag_id, name } = req.body;

  try {
    let tagId = tag_id;

    // If name provided, find or create tag
    if (!tagId && name) {
      const trimmed = name.trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'タグ名は必須です' });
      }

      const existing = await pool.query<{ id: string }>(
        'SELECT id FROM tags WHERE room_id = $1 AND name = $2',
        [roomId, trimmed]
      );

      if (existing.rows.length > 0) {
        tagId = existing.rows[0].id;
      } else {
        const created = await pool.query<TagRow>(
          `INSERT INTO tags (room_id, name, created_by)
           VALUES ($1, $2, $3) RETURNING *`,
          [roomId, trimmed, userId]
        );
        tagId = created.rows[0].id;
      }
    }

    if (!tagId) {
      return res.status(400).json({ error: 'tag_id または name は必須です' });
    }

    // Check if already tagged
    const existing = await pool.query(
      'SELECT 1 FROM message_tags WHERE message_id = $1 AND tag_id = $2',
      [messageId, tagId]
    );

    if (existing.rows.length > 0) {
      const tag = await pool.query<TagRow>('SELECT * FROM tags WHERE id = $1', [tagId]);
      return res.status(200).json({ tag: tag.rows[0] });
    }

    // Add tag to message
    await pool.query(
      `INSERT INTO message_tags (message_id, tag_id, created_by)
       VALUES ($1, $2, $3)`,
      [messageId, tagId, userId]
    );

    // Return the tag
    const tag = await pool.query<TagRow>('SELECT * FROM tags WHERE id = $1', [tagId]);

    res.status(201).json({ tag: tag.rows[0] });
  } catch (err) {
    logger.error('Message tag add error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/messages/:id/tags
 * Get tags on a message
 */
messageRouter.get('/', async (req, res) => {
  const messageId = (req.params as { id: string }).id;

  try {
    const result = await pool.query(
      `SELECT t.*, mt.is_done, mt.priority FROM tags t
       JOIN message_tags mt ON mt.tag_id = t.id
       WHERE mt.message_id = $1
       ORDER BY t.name`,
      [messageId]
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('Message tags get error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PATCH /api/messages/:id/tags/:tagId
 * Update is_done / priority on a message-tag
 */
messageRouter.patch('/:tagId', async (req, res) => {
  const messageId = (req.params as { id: string; tagId: string }).id;
  const tagId = (req.params as { tagId: string }).tagId;
  const { is_done, priority } = req.body;

  try {
    await pool.query(
      `UPDATE message_tags
       SET is_done = COALESCE($1, is_done), priority = COALESCE($2, priority)
       WHERE message_id = $3 AND tag_id = $4`,
      [is_done, priority, messageId, tagId]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Message tag update error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/messages/:id/tags/:tagId
 * Remove a tag from a message
 */
messageRouter.delete('/:tagId', async (req, res) => {
  const messageId = (req.params as { id: string; tagId: string }).id;
  const tagId = (req.params as { tagId: string }).tagId;

  try {
    await pool.query(
      'DELETE FROM message_tags WHERE message_id = $1 AND tag_id = $2',
      [messageId, tagId]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Message tag remove error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// ============================================
// Global tag routes: /api/tags
// ============================================
export const globalRouter = express.Router();
globalRouter.use(authenticate);

/**
 * GET /api/tags/all
 * Aggregate tags across all rooms the user belongs to
 */
globalRouter.get('/all', async (req, res) => {
  const userId = req.user!.id;
  const limit = Math.min(parseInt(String(req.query.limit)) || 30, 100);

  try {
    const result = await pool.query<{ name: string; is_todo: boolean; total_usage: number }>(
      `SELECT t.name, t.is_todo, COUNT(mt.message_id)::int AS total_usage
       FROM tags t
       JOIN room_members rm ON rm.room_id = t.room_id AND rm.user_id = $1
       LEFT JOIN message_tags mt ON mt.tag_id = t.id
       GROUP BY t.name, t.is_todo
       ORDER BY total_usage DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({ tags: result.rows });
  } catch (err) {
    logger.error('Global tag list error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
