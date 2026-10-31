import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import { pool } from '../db/pool.mts';
import { isUuid, badIdMessage } from '../utils/uuid.mts';

/**
 * Middleware: Require room membership
 * Sets req.params.id as roomId (mergeParams required on router)
 */
export async function requireMember(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const roomId = req.params.id;
  const userId = req.user!.id;
  // ★ 2026-09-29: 形の崩れた部屋の ID を DB に投げ、500 を返していた。400 と理由を返す
  if (!isUuid(roomId)) return res.status(400).json({ error: badIdMessage(String(roomId)) });

  try {
    const result = await pool.query<{ role: string }>(
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
 * 部屋の管理者の口だけに使う入口 (2026-10-31 小野さん判断 5)。
 * メンバーなら requireMember と同じ。メンバーでなくても、システム管理者なら通す (req.memberRole は空のまま)。
 * ★ 中身を読む口には使わないこと (システム管理者でも、メンバーでない部屋の中身は読まない。docs/02 room_members)
 */
export async function requireMemberOrSystemAdmin(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  if (req.user?.role !== 'admin') return requireMember(req, res, next);
  const roomId = req.params.id;
  if (!isUuid(roomId)) return res.status(400).json({ error: badIdMessage(String(roomId)) });
  try {
    const result = await pool.query<{ role: string }>(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, req.user.id]
    );
    req.memberRole = result.rows[0]?.role;
    next();
  } catch (err) {
    logger.error('Room access check error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
}

/** 部屋の管理者として扱うか。★ システム管理者は、どのグループ部屋でも部屋の管理者と同じ (2026-10-31 小野さん判断 5) */
export function isRoomAdmin(req: Request): boolean {
  return req.memberRole === 'admin' || req.user?.role === 'admin';
}

/**
 * Middleware: Require room admin role
 * Must be used after requireMember (or requireMemberOrSystemAdmin)
 */
export function requireRoomAdmin(req: Request, res: Response, next: NextFunction): Response | void {
  if (!isRoomAdmin(req)) {
    return res.status(403).json({ error: E.GROUP_ADMIN_REQUIRED });
  }
  next();
}

/**
 * Middleware: Require room to be a group (not direct)
 */
export async function requireGroup(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const roomId = req.params.id;
  try {
    const room = await pool.query<{ type: string }>('SELECT type FROM rooms WHERE id = $1', [roomId]);
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
export async function requireCreator(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const roomId = req.params.id;
  const userId = req.user!.id;
  try {
    const result = await pool.query<{ created_by: string }>('SELECT created_by FROM rooms WHERE id = $1', [roomId]);
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
export async function requireSoloMember(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const roomId = req.params.id;
  const userId = req.user!.id;
  try {
    const result = await pool.query<{ n: number }>(
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
