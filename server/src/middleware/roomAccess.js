const logger = require('../utils/logger');
const E = require('../constants/errors');
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
      return res.status(403).json({ error: E.ROOM_ACCESS_DENIED });
    }
    req.memberRole = result.rows[0].role;
    next();
  } catch (err) {
    logger.error('Room access check error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
}

/**
 * Middleware: Require room admin role
 * Must be used after requireMember
 */
function requireRoomAdmin(req, res, next) {
  if (req.memberRole !== 'admin') {
    return res.status(403).json({ error: E.GROUP_ADMIN_REQUIRED });
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
      return res.status(404).json({ error: E.ROOM_NOT_FOUND });
    }
    if (room.rows[0].type !== 'group') {
      return res.status(400).json({ error: E.ROOM_GROUP_ONLY });
    }
    next();
  } catch (err) {
    logger.error('Room type check error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
}

/**
 * Middleware: Require the authenticated user to be the room creator
 * (rooms.created_by = req.user.id)
 */
async function requireCreator(req, res, next) {
  const roomId = req.params.id;
  const userId = req.user.id;
  try {
    const result = await pool.query('SELECT created_by FROM rooms WHERE id = $1', [roomId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: E.ROOM_NOT_FOUND });
    }
    if (result.rows[0].created_by !== userId) {
      return res.status(403).json({ error: E.ROOM_CREATOR_ONLY });
    }
    next();
  } catch (err) {
    logger.error('Room creator check error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
}

/**
 * Middleware: Require the authenticated user to be the only remaining member
 * (no other room_members exist besides self)
 * Used for room deletion safety: forces "remove all other members first" workflow
 */
async function requireSoloMember(req, res, next) {
  const roomId = req.params.id;
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS n FROM room_members WHERE room_id = $1 AND user_id <> $2',
      [roomId, userId]
    );
    if (result.rows[0].n > 0) {
      return res.status(409).json({ error: E.ROOM_NOT_SOLO });
    }
    next();
  } catch (err) {
    logger.error('Solo member check error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
}

module.exports = { requireMember, requireRoomAdmin, requireGroup, requireCreator, requireSoloMember };
