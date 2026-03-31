const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

/**
 * Helper: Check room is group type
 */
async function requireGroup(req, res, next) {
  const { id: roomId } = req.params;
  const room = await pool.query('SELECT type FROM rooms WHERE id = $1', [roomId]);
  if (room.rows.length === 0) {
    return res.status(404).json({ error: 'ルームが見つかりません' });
  }
  if (room.rows[0].type !== 'group') {
    return res.status(400).json({ error: 'この操作はグループのみ対象です' });
  }
  next();
}

/**
 * Helper: Check user is member of room
 */
async function requireMembership(req, res, next) {
  const { id: roomId } = req.params;
  const result = await pool.query(
    'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(403).json({ error: 'このルームのメンバーではありません' });
  }
  req.memberRole = result.rows[0].role;
  next();
}

/**
 * Helper: Insert system message
 */
async function insertSystemMessage(roomId, content, io) {
  const result = await pool.query(
    `INSERT INTO messages (room_id, sender_id, content, type)
     VALUES ($1, (SELECT user_id FROM room_members WHERE room_id = $1 LIMIT 1), $2, 'system')
     RETURNING *`,
    [roomId, content]
  );

  if (io) {
    io.to(roomId).emit('message:new', {
      ...result.rows[0],
      sender_display_name: 'システム',
    });
  }
}

/**
 * POST /api/rooms/:id/members
 * Add a member to the group (any member can invite)
 */
router.post('/', authenticate, requireGroup, requireMembership, async (req, res) => {
  const roomId = req.params.id;
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
    const userResult = await pool.query(
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
    const addedName = userResult.rows[0].display_name;
    const adderName = req.user.display_name;
    const { io } = require('../app');
    await insertSystemMessage(roomId, `${adderName}が${addedName}を追加しました`, io);

    io.to(roomId).emit('member:added', { room_id: roomId, user_id, display_name: addedName });

    res.json({ member: result.rows[0] });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * DELETE /api/rooms/:id/members/me
 * Leave the group
 */
router.delete('/me', authenticate, requireGroup, requireMembership, async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  try {
    // Check if last admin
    if (req.memberRole === 'admin') {
      const adminCount = await pool.query(
        "SELECT COUNT(*)::int as count FROM room_members WHERE room_id = $1 AND role = 'admin'",
        [roomId]
      );
      const memberCount = await pool.query(
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
    const { io } = require('../app');
    await insertSystemMessage(roomId, `${req.user.display_name}が退会しました`, io);
    io.to(roomId).emit('member:removed', { room_id: roomId, user_id: userId });

    res.json({ message: '退会しました' });
  } catch (err) {
    console.error('Leave group error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * DELETE /api/rooms/:id/members/:userId
 * Kick a member (group admin only)
 */
router.delete('/:userId', authenticate, requireGroup, requireMembership, async (req, res) => {
  const roomId = req.params.id;
  const targetUserId = req.params.userId;

  // Must be admin
  if (req.memberRole !== 'admin') {
    return res.status(403).json({ error: 'グループ管理者のみがメンバーを除外できます' });
  }

  // Cannot kick self
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: '自分自身を除外することはできません。退会を使用してください。' });
  }

  try {
    // Check target is a member
    const target = await pool.query(
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
    const { io } = require('../app');
    await insertSystemMessage(roomId, `${req.user.display_name}が${targetName}を退会させました`, io);
    io.to(roomId).emit('member:removed', { room_id: roomId, user_id: targetUserId });

    res.json({ message: `${targetName}を除外しました` });
  } catch (err) {
    console.error('Kick member error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * PUT /api/rooms/:id/members/:userId/role
 * Change member role (group admin only)
 */
router.put('/:userId/role', authenticate, requireGroup, requireMembership, async (req, res) => {
  const roomId = req.params.id;
  const targetUserId = req.params.userId;
  const { role } = req.body;

  if (req.memberRole !== 'admin') {
    return res.status(403).json({ error: 'グループ管理者のみが権限を変更できます' });
  }

  if (!role || !['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role は admin または member を指定してください' });
  }

  try {
    // Check target is a member
    const target = await pool.query(
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
    const { io } = require('../app');
    if (role === 'admin') {
      await insertSystemMessage(roomId, `${req.user.display_name}が${targetName}をグループ管理者にしました`, io);
    } else {
      await insertSystemMessage(roomId, `${req.user.display_name}が${targetName}のグループ管理者を解除しました`, io);
    }

    res.json({ member: result.rows[0] });
  } catch (err) {
    console.error('Change role error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

module.exports = router;
