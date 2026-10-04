/**
 * クライアント側 permission helper (#282 Phase D)
 *
 * server/src/utils/permissions.mts と同じ role セマンティクスをクライアントでも持ち、
 * guest に対して使えない UI（room 作成 / メンバー招待 / user 検索 等）を非表示にする。
 * server 側が 403 で最終防御するので、これは「死にボタン」を見せない UX 整合のため。
 */

/** role を持ちうる object (User のほか、partial なテスト用 user も受ける) */
export type UserLike = { role?: string | null; is_bot?: boolean } | null | undefined;

export function getRole(user: UserLike): string | null {
  if (!user || typeof user !== 'object') return null;
  return user.role || null;
}

export function isAdmin(user: UserLike): boolean {
  return getRole(user) === 'admin';
}

export function isGuest(user: UserLike): boolean {
  return getRole(user) === 'guest';
}

/** room / direct 作成権限。guest は不可。 */
export function canCreateRoom(user: UserLike): boolean {
  return !isGuest(user);
}

/** room へ他 user を招待する権限。guest は不可。 */
export function canInviteToRoom(user: UserLike): boolean {
  return !isGuest(user);
}

/** ★ #495 スタンプを作る権限。guest は送るだけ (サーバーの POST /api/stamps/generate も 403) */
export function canCreateStamp(user: UserLike): boolean {
  return !isGuest(user);
}

/**
 * #485-2 部屋を画面から削除できるか。サーバーの DELETE /api/rooms/:id と同じ条件
 * (グループ・作った本人・自分しかいない)。外れた人に「押すと 403 になるボタン」を見せない。
 */
export function canDeleteRoom(
  room: { type?: string; created_by?: string } | null | undefined,
  userId: string | undefined,
  memberIds: string[],
): boolean {
  if (!room || !userId) return false;
  if (room.type !== 'group' || !room.created_by || room.created_by !== userId) return false;
  return memberIds.length === 1 && memberIds[0] === userId;
}

/** role の日本語表示ラベル。 */
export function roleLabel(user: UserLike): string {
  if (user?.is_bot) return 'BOT';
  const role = getRole(user);
  if (role === 'admin') return '管理者';
  if (role === 'guest') return 'ゲスト';
  return '一般';
}
