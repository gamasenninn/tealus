/**
 * クライアント側 permission helper (#282 Phase D)
 *
 * server/src/utils/permissions.js と同じ role セマンティクスをクライアントでも持ち、
 * guest に対して使えない UI（room 作成 / メンバー招待 / user 検索 等）を非表示にする。
 * server 側が 403 で最終防御するので、これは「死にボタン」を見せない UX 整合のため。
 */

export function getRole(user) {
  if (!user || typeof user !== 'object') return null;
  return user.role || null;
}

export function isAdmin(user) {
  return getRole(user) === 'admin';
}

export function isGuest(user) {
  return getRole(user) === 'guest';
}

/** room / direct 作成権限。guest は不可。 */
export function canCreateRoom(user) {
  return !isGuest(user);
}

/** room へ他 user を招待する権限。guest は不可。 */
export function canInviteToRoom(user) {
  return !isGuest(user);
}

/** role の日本語表示ラベル。 */
export function roleLabel(user) {
  if (user?.is_bot) return 'BOT';
  const role = getRole(user);
  if (role === 'admin') return '管理者';
  if (role === 'guest') return 'ゲスト';
  return '一般';
}
