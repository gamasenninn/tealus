import { getIo } from '../io-registry.mts';
import express from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'socket.io';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember, requireGroup } from '../middleware/roomAccess.mts';
import { canInviteToRoom } from '../utils/permissions.mts';
import { fireWebhooks } from '../services/webhook.mts';
import { insertSystemMessage } from '../services/systemMessage.mts';

export const router = express.Router({ mergeParams: true });

// Helper: Insert system message (#390 で services/systemMessage.mts へ移動。bot join と共有)

/**
 * POST /api/rooms/:id/members
 * Add a member to the group (any member can invite)
 */
router.post('/', authenticate, requireGroup, requireMember, async (req: Request, res: Response) => {
  // #282: guest は member であっても他 user を招待できない (fail-closed)。
  // client は招待ボタンを隠すが、API 直叩きもサーバーで弾く。
  if (!canInviteToRoom(req.user)) {
    return res.status(403).json({ error: 'ゲストユーザはメンバーを招待できません' });
  }
  const roomId = (req.params as { id: string }).id;
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id は必須です' });
  }

  try {
    // Check if already a member
    const existing = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, user_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: '既にメンバーです' });
    }

    // Check user exists
    const userResult = await pool.query<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM users WHERE id = $1 AND is_active = true',
      [user_id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    // Add member
    const result = await pool.query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'member')
       RETURNING room_id, user_id, role, joined_at`,
      [roomId, user_id]
    );

    // System message
    // (routes → app は真の循環依存のため、元の lazy require の意図を動的 import で保持)
    const addedName = userResult.rows[0].display_name;
    const adderName = req.user!.display_name;
    const io = getIo();
    await insertSystemMessage(roomId, `${adderName}が${addedName}を追加しました`, io);

    io.to(roomId).emit('member:added', { room_id: roomId, user_id, display_name: addedName });

    // Webhook notification
    fireWebhooks('member.joined', roomId, {
      room: { id: roomId },
      member: { id: user_id, display_name: addedName },
      added_by: { id: req.user!.id, display_name: adderName },
    });

    res.json({ member: result.rows[0] });
  } catch (err) {
    logger.error('Add member error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/rooms/:id/members/me
 * Leave the group
 */
router.delete('/me', authenticate, requireGroup, requireMember, async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const userId = req.user!.id;

  try {
    // Check if last admin
    if (req.memberRole === 'admin') {
      const adminCount = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::int as count FROM room_members WHERE room_id = $1 AND role = 'admin'",
        [roomId]
      );
      const memberCount = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM room_members WHERE room_id = $1',
        [roomId]
      );
      // Only block if there are other members but no other admin
      if (adminCount.rows[0].count <= 1 && memberCount.rows[0].count > 1) {
        return res.status(400).json({
          error: 'あなたは最後のグループ管理者です。先に他のメンバーをグループ管理者に変更してください。'
        });
      }
    }

    // Remove member
    await pool.query(
      'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );

    // System message
    const io = getIo();
    await insertSystemMessage(roomId, `${req.user!.display_name}が退会しました`, io);
    io.to(roomId).emit('member:removed', { room_id: roomId, user_id: userId });

    // Webhook notification
    fireWebhooks('member.left', roomId, {
      room: { id: roomId },
      member: { id: userId, display_name: req.user!.display_name },
    });

    res.json({ message: '退会しました' });
  } catch (err) {
    logger.error('Leave group error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/rooms/:id/members/:userId
 * Kick a member (group: admin only / direct: 本来の 2 人が 3 人目を外す — #391)
 *
 * ★ requireGroup を外してある。#390 で join の穴は塞いだが、**出口が無かった**ため
 *   1 件を DB 直操作で外す羽目になった。「入れないが、万一入っていたら出せる」が本来の形。
 *
 * ★ direct には admin が居ない (作成時に 2 人とも role='member')。したがって group と同じ
 *   admin 判定は使えず、**joined_at が最古のメンバー = 本来の 2 人** を基準にする:
 *     - 本来の 2 人だけが操作できる (侵入した側が本人を追い出せない)
 *     - 本来の 2 人は外せない (= 2 人を下回らない)
 *   3 人全員の joined_at が同一という異常な状態では誰も外せない = 安全側に倒れる。
 */
router.delete('/:userId', authenticate, requireMember, async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const targetUserId = (req.params as { userId: string }).userId;

  // Cannot kick self
  if (targetUserId === req.user!.id) {
    return res.status(400).json({ error: '自分自身を除外することはできません。退会を使用してください。' });
  }

  try {
    const roomType = await pool.query<{ type: string }>('SELECT type FROM rooms WHERE id = $1', [roomId]);
    if (roomType.rows.length === 0) {
      return res.status(404).json({ error: E.ROOM_NOT_FOUND });
    }

    if (roomType.rows[0].type === 'group') {
      if (req.memberRole !== 'admin') {
        return res.status(403).json({ error: 'グループ管理者のみがメンバーを除外できます' });
      }
    } else {
      // direct: 本来の 2 人 = joined_at が最古の行
      const original = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM room_members
          WHERE room_id = $1
            AND joined_at = (SELECT MIN(joined_at) FROM room_members WHERE room_id = $1)`,
        [roomId]
      );
      const originalIds = original.rows.map((r) => r.user_id);
      if (!originalIds.includes(req.user!.id)) {
        return res.status(403).json({ error: E.DIRECT_ORIGINAL_MEMBER_REQUIRED });
      }
      if (originalIds.includes(targetUserId)) {
        return res.status(400).json({ error: E.DIRECT_ORIGINAL_MEMBER_PROTECTED });
      }
    }

    // Check target is a member
    const target = await pool.query<{ user_id: string; display_name: string }>(
      `SELECT rm.user_id, u.display_name FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1 AND rm.user_id = $2`,
      [roomId, targetUserId]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'メンバーが見つかりません' });
    }

    // Remove member
    await pool.query(
      'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, targetUserId]
    );

    // System message
    const targetName = target.rows[0].display_name;
    const io = getIo();
    await insertSystemMessage(roomId, `${req.user!.display_name}が${targetName}を退会させました`, io);
    io.to(roomId).emit('member:removed', { room_id: roomId, user_id: targetUserId });

    // Webhook notification
    fireWebhooks('member.left', roomId, {
      room: { id: roomId },
      member: { id: targetUserId, display_name: targetName },
      removed_by: { id: req.user!.id, display_name: req.user!.display_name },
    });

    res.json({ message: `${targetName}を除外しました` });
  } catch (err) {
    logger.error('Kick member error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/rooms/:id/members/:userId/role
 * Change member role (group admin only)
 */
router.put('/:userId/role', authenticate, requireGroup, requireMember, async (req: Request, res: Response) => {
  const roomId = (req.params as { id: string }).id;
  const targetUserId = (req.params as { userId: string }).userId;
  const { role } = req.body;

  if (req.memberRole !== 'admin') {
    return res.status(403).json({ error: 'グループ管理者のみが権限を変更できます' });
  }

  if (!role || !['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role は admin または member を指定してください' });
  }

  try {
    // Check target is a member
    const target = await pool.query<{ user_id: string; role: string; display_name: string }>(
      `SELECT rm.user_id, rm.role, u.display_name FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1 AND rm.user_id = $2`,
      [roomId, targetUserId]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'メンバーが見つかりません' });
    }

    const result = await pool.query(
      'UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3 RETURNING room_id, user_id, role, joined_at',
      [role, roomId, targetUserId]
    );

    // System message
    const targetName = target.rows[0].display_name;
    const io = getIo();
    if (role === 'admin') {
      await insertSystemMessage(roomId, `${req.user!.display_name}が${targetName}をグループ管理者にしました`, io);
    } else {
      await insertSystemMessage(roomId, `${req.user!.display_name}が${targetName}のグループ管理者を解除しました`, io);
    }

    res.json({ member: result.rows[0] });
  } catch (err) {
    logger.error('Change role error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
