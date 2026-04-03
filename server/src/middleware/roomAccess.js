const pool = require('../db/pool');

/**
 * Middleware: Require room membership
 * Sets req.params.id as roomId (mergeParams required on router)
 */
async function requireMember(req, res, next) {
  const roomId = req.params.id;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'このルームにアクセスする権限がありません' });
    }
    req.memberRole = result.rows[0].role;
    next();
  } catch (err) {
    console.error('Room access check error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

/**
 * Middleware: Require room admin role
 * Must be used after requireMember
 */
function requireRoomAdmin(req, res, next) {
  if (req.memberRole !== 'admin') {
    return res.status(403).json({ error: 'グループ管理者のみが実行できます' });
  }
  next();
}

/**
 * Middleware: Require room to be a group (not direct)
 */
async function requireGroup(req, res, next) {
  const roomId = req.params.id;
  try {
    const room = await pool.query('SELECT type FROM rooms WHERE id = $1', [roomId]);
    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }
    if (room.rows[0].type !== 'group') {
      return res.status(400).json({ error: 'この操作はグループのみ対象です' });
    }
    next();
  } catch (err) {
    console.error('Room type check error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = { requireMember, requireRoomAdmin, requireGroup };
