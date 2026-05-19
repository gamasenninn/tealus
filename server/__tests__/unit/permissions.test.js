/**
 * Permission helpers unit test (#282 Phase B)
 *
 * 検証観点:
 * - role-class checks (isAdmin / isUser / isGuest) の対称性 + null-safe
 * - ability checks (canCreateRoom / canInviteToRoom / canSearchUsers) の guest 制限
 * - 不正 / 未定義 input に対する safe fallback (= false 返却)
 */
const {
  ROLES,
  getRole,
  isAdmin,
  isUser,
  isGuest,
  canCreateRoom,
  canInviteToRoom,
  canSearchUsers,
} = require('../../src/utils/permissions');

const adminUser = { id: 'a1', role: 'admin', display_name: 'Admin' };
const normalUser = { id: 'u1', role: 'user', display_name: 'User' };
const guestUser = { id: 'g1', role: 'guest', display_name: 'Guest' };

describe('ROLES constant', () => {
  test('値が freeze されている', () => {
    expect(ROLES.ADMIN).toBe('admin');
    expect(ROLES.USER).toBe('user');
    expect(ROLES.GUEST).toBe('guest');
    expect(Object.isFrozen(ROLES)).toBe(true);
  });
});

describe('getRole', () => {
  test('user.role を返す', () => {
    expect(getRole(adminUser)).toBe('admin');
    expect(getRole(guestUser)).toBe('guest');
  });

  test('null-safe: undefined / null / 非 object は null 返却', () => {
    expect(getRole(null)).toBeNull();
    expect(getRole(undefined)).toBeNull();
    expect(getRole('admin')).toBeNull();
    expect(getRole(123)).toBeNull();
  });

  test('role field 欠落でも null 返却', () => {
    expect(getRole({ id: 'x' })).toBeNull();
    expect(getRole({})).toBeNull();
  });
});

describe('isAdmin / isUser / isGuest — 対称性 + null-safe', () => {
  test('admin user に対して isAdmin だけ true', () => {
    expect(isAdmin(adminUser)).toBe(true);
    expect(isUser(adminUser)).toBe(false);
    expect(isGuest(adminUser)).toBe(false);
  });

  test('normal user に対して isUser だけ true', () => {
    expect(isAdmin(normalUser)).toBe(false);
    expect(isUser(normalUser)).toBe(true);
    expect(isGuest(normalUser)).toBe(false);
  });

  test('guest user に対して isGuest だけ true', () => {
    expect(isAdmin(guestUser)).toBe(false);
    expect(isUser(guestUser)).toBe(false);
    expect(isGuest(guestUser)).toBe(true);
  });

  test('null / undefined / 不明 role は全 false', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isUser(undefined)).toBe(false);
    expect(isGuest({ role: 'unknown' })).toBe(false);
    expect(isAdmin({})).toBe(false);
  });
});

describe('canCreateRoom — admin/user は可、guest は不可', () => {
  test('admin は room 作成可', () => {
    expect(canCreateRoom(adminUser)).toBe(true);
  });

  test('normal user は room 作成可', () => {
    expect(canCreateRoom(normalUser)).toBe(true);
  });

  test('guest は room 作成不可', () => {
    expect(canCreateRoom(guestUser)).toBe(false);
  });

  test('null / 不明 role は不可 (= safe fallback)', () => {
    expect(canCreateRoom(null)).toBe(false);
    expect(canCreateRoom({ role: 'unknown' })).toBe(false);
  });
});

describe('canInviteToRoom — admin/user は可、guest は不可', () => {
  test('admin / user は招待可', () => {
    expect(canInviteToRoom(adminUser)).toBe(true);
    expect(canInviteToRoom(normalUser)).toBe(true);
  });

  test('guest は招待不可', () => {
    expect(canInviteToRoom(guestUser)).toBe(false);
  });
});

describe('canSearchUsers — admin/user は可、guest は不可', () => {
  test('admin / user は user 検索可', () => {
    expect(canSearchUsers(adminUser)).toBe(true);
    expect(canSearchUsers(normalUser)).toBe(true);
  });

  test('guest は user 検索不可', () => {
    expect(canSearchUsers(guestUser)).toBe(false);
  });
});
