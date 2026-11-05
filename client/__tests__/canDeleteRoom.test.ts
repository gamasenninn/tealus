/**
 * #485-2 部屋を画面から削除できるのは、サーバーの DELETE /api/rooms/:id と同じ条件のときだけ。
 * 条件を外れた人に「押すと 403 になるボタン」を見せない。
 * ★ #643 (2026-11-05 小野さん判断 4): 作った本人でなくても、自分しかいない部屋なら消せる。システム管理者はいつでも消せる
 */
import { describe, it, expect } from 'vitest';
import { canDeleteRoom } from '../src/utils/permissions';

describe('canDeleteRoom (#485-2・#643)', () => {
  const me = 'u-me';
  const group = { type: 'group' as const, created_by: me };

  it('グループ・自分しかいない → 削除できる', () => {
    expect(canDeleteRoom(group, me, [me])).toBe(true);
  });

  it('ほかのメンバーが残っている → できない (先に退会させる)', () => {
    expect(canDeleteRoom(group, me, [me, 'u-other'])).toBe(false);
  });

  it('★ 作った本人でなくても、自分しかいない → できる (#643)', () => {
    expect(canDeleteRoom({ type: 'group', created_by: 'u-other' }, me, [me])).toBe(true);
    expect(canDeleteRoom({ type: 'group' }, me, [me])).toBe(true);
  });

  it('★ システム管理者は、ほかのメンバーが残っていても・メンバーでなくても → できる (#643)', () => {
    expect(canDeleteRoom(group, me, [me, 'u-other'], true)).toBe(true);
    expect(canDeleteRoom({ type: 'group', created_by: 'u-other' }, me, ['u-other'], true)).toBe(true);
  });

  it('1 対 1 → できない (システム管理者でも)', () => {
    expect(canDeleteRoom({ type: 'direct', created_by: me }, me, [me])).toBe(false);
    expect(canDeleteRoom({ type: 'direct', created_by: me }, me, [me], true)).toBe(false);
  });

  it('部屋・自分が無い → できない', () => {
    expect(canDeleteRoom(null, me, [me])).toBe(false);
    expect(canDeleteRoom(group, undefined, [me])).toBe(false);
  });
});
