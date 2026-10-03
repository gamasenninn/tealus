/**
 * #485-2 部屋を画面から削除できるのは、サーバーの DELETE /api/rooms/:id と同じ条件のときだけ
 * (グループ・作った本人・自分しかいない)。条件を外れた人に「押すと 403 になるボタン」を見せない。
 */
import { describe, it, expect } from 'vitest';
import { canDeleteRoom } from '../src/utils/permissions';

describe('canDeleteRoom (#485-2)', () => {
  const me = 'u-me';
  const group = { type: 'group' as const, created_by: me };

  it('グループ・作った本人・自分しかいない → 削除できる', () => {
    expect(canDeleteRoom(group, me, [me])).toBe(true);
  });

  it('ほかのメンバーが残っている → できない (先に退会させる)', () => {
    expect(canDeleteRoom(group, me, [me, 'u-other'])).toBe(false);
  });

  it('作った本人でない → できない', () => {
    expect(canDeleteRoom({ type: 'group', created_by: 'u-other' }, me, [me])).toBe(false);
  });

  it('1 対 1 → できない', () => {
    expect(canDeleteRoom({ type: 'direct', created_by: me }, me, [me])).toBe(false);
  });

  it('作った人が分からない (古い部屋) → できない', () => {
    expect(canDeleteRoom({ type: 'group' }, me, [me])).toBe(false);
  });

  it('部屋・自分が無い → できない', () => {
    expect(canDeleteRoom(null, me, [me])).toBe(false);
    expect(canDeleteRoom(group, undefined, [me])).toBe(false);
  });
});
