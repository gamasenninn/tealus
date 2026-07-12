import { describe, it, expect } from 'vitest';
import { isAdmin, isGuest, canCreateRoom, canInviteToRoom, roleLabel } from '../src/utils/permissions';

describe('client permissions helper (#282 Phase D)', () => {
  const admin = { role: 'admin' };
  const user = { role: 'user' };
  const guest = { role: 'guest' };
  const bot = { role: 'user', is_bot: true };

  it('isAdmin / isGuest が role を正しく判定', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(user)).toBe(false);
    expect(isGuest(guest)).toBe(true);
    expect(isGuest(user)).toBe(false);
    expect(isGuest(null)).toBe(false);
  });

  it('canCreateRoom / canInviteToRoom は guest のみ false', () => {
    expect(canCreateRoom(admin)).toBe(true);
    expect(canCreateRoom(user)).toBe(true);
    expect(canCreateRoom(guest)).toBe(false);
    expect(canInviteToRoom(guest)).toBe(false);
    expect(canInviteToRoom(user)).toBe(true);
  });

  it('roleLabel が日本語ラベルを返す (bot 優先)', () => {
    expect(roleLabel(admin)).toBe('管理者');
    expect(roleLabel(user)).toBe('一般');
    expect(roleLabel(guest)).toBe('ゲスト');
    expect(roleLabel(bot)).toBe('BOT');
  });
});
