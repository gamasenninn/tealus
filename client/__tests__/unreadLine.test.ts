/**
 * 「ここから未読」の線 (2026-10-30 改善ループ 26 回目)
 * ★ 既読の次が自分の便だと、その先に他人の未読があっても線が出なかった
 */
import { describe, it, expect } from 'vitest';
import { findUnreadStartId } from '../src/utils/unreadLine';

const m = (id: string, sender_id: string, is_deleted = false) => ({ id, sender_id, is_deleted });

describe('findUnreadStartId', () => {
  it('★★ 既読の次が自分の便でも、その先の他人の最初の便に線を出す', () => {
    expect(findUnreadStartId([m('1', 'a'), m('2', 'me'), m('3', 'b')], '1', 'me')).toBe('3');
  });

  it('削除された便は飛ばす (一覧の未読に数えない)', () => {
    expect(findUnreadStartId([m('1', 'a'), m('2', 'b', true), m('3', 'b')], '1', 'me')).toBe('3');
  });

  it('既読のあとが自分の便だけなら線を出さない', () => {
    expect(findUnreadStartId([m('1', 'a'), m('2', 'me')], '1', 'me')).toBeNull();
  });

  it('既読の位置が無い・見つからないなら出さない', () => {
    expect(findUnreadStartId([m('1', 'a')], null, 'me')).toBeNull();
    expect(findUnreadStartId([m('1', 'a')], 'x', 'me')).toBeNull();
  });
});
