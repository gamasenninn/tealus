/**
 * Permission helpers — users.role / room.role に基づく capability check
 *
 * Tealus 根幹原則 (AI と人間の区別は最小限、interaction primitive は同じ) を維持しつつ、
 * users.role の 3 class (admin / user / guest) に対応した capability check を一元化する。
 *
 * 関連: #282 Phase B (ゲストユーザ role 拡張)、#124 pivot
 *
 * 使い方:
 *   const { isAdmin, isGuest, canCreateRoom } = require('../utils/permissions');
 *   if (!isAdmin(req.user)) { return res.status(403)... }
 *   if (!canCreateRoom(req.user)) { return res.status(403)... }
 */

const ROLES = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
  GUEST: 'guest',
});

/**
 * Get user's role with null-safe access
 * @param {object|null|undefined} user
 * @returns {string|null}
 */
function getRole(user) {
  if (!user || typeof user !== 'object') return null;
  return user.role || null;
}

// ===== Role-class checks =====

/**
 * Returns true if user.role === 'admin'
 */
function isAdmin(user) {
  return getRole(user) === ROLES.ADMIN;
}

/**
 * Returns true if user.role === 'user' (一般 user、admin / guest ではない)
 */
function isUser(user) {
  return getRole(user) === ROLES.USER;
}

/**
 * Returns true if user.role === 'guest'
 */
function isGuest(user) {
  return getRole(user) === ROLES.GUEST;
}

// ===== Ability checks (Phase B: minimum subset、Phase C で拡張) =====

/**
 * 新規 room 作成権限。admin / user は OK、guest は不可。
 */
function canCreateRoom(user) {
  return isAdmin(user) || isUser(user);
}

/**
 * room へ他 user を招待する権限。
 * admin: any room、user: 自分が member の room (= 呼び出し側で member 判定して渡す)、guest: 不可。
 *
 * 本 helper は role-class レベルの判定のみ、room membership は呼び出し側で行う。
 *
 * @param {object} user
 * @returns {boolean}
 */
function canInviteToRoom(user) {
  return isAdmin(user) || isUser(user);
}

/**
 * 他 user の情報を検索 / 一覧する権限。
 * admin: any、user: 同 organization 内、guest: 自分自身のみ。
 *
 * 本 helper は role-class レベル、specific filter は呼び出し側で実装する。
 *
 * @param {object} user
 * @returns {boolean} true なら検索可、false なら 403
 */
function canSearchUsers(user) {
  return isAdmin(user) || isUser(user);
}

module.exports = {
  ROLES,
  getRole,
  isAdmin,
  isUser,
  isGuest,
  canCreateRoom,
  canInviteToRoom,
  canSearchUsers,
};
