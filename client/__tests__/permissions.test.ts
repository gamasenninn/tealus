import { describe, it, expect } from 'vitest';
import { isAdmin, isGuest, canCreateRoom, canInviteToRoom, canCreateStamp, canDeleteRoomTag, roleLabel } from '../src/utils/permissions';

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

  it('★ #496 canDeleteRoomTag: 作った人 / 部屋の管理者 / システム管理者だけ', () => {
    const tag = { created_by: 'u-maker' };
    expect(canDeleteRoomTag(tag, { id: 'u-maker', role: 'user' }, 'member')).toBe(true);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'user' }, 'admin')).toBe(true);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'admin' }, 'member')).toBe(true);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'user' }, 'member')).toBe(false);
    expect(canDeleteRoomTag(tag, { id: 'u-x', role: 'guest' }, 'member')).toBe(false);
    expect(canDeleteRoomTag({ created_by: null }, { id: 'u-x', role: 'user' }, 'member')).toBe(false);
    expect(canDeleteRoomTag(tag, null, undefined)).toBe(false);
  });

  it('★ #495 canCreateStamp は guest のみ false (送るだけ)', () => {
    expect(canCreateStamp(admin)).toBe(true);
    expect(canCreateStamp(user)).toBe(true);
    expect(canCreateStamp(guest)).toBe(false);
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
