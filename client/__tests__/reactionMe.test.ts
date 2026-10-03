/**
 * #488 リアクションの知らせは「誰が付けたか (user_ids)」で届く。「自分が付けたか (me)」は各端末が自分の ID で決める
 * ★ 以前は付けた本人の目線の me がそのまま全員に配られ、付けていない人の画面でも「自分が付けた」と出た
 */
import { describe, it, expect } from 'vitest';
import { withMe } from '../src/utils/reactionMe';

describe('withMe (#488)', () => {
  it('自分の ID が user_ids にあれば me = true、なければ false', () => {
    const out = withMe([
      { emoji: '👍', count: 1, user_ids: ['u-b'] },
      { emoji: '❤️', count: 2, user_ids: ['u-a', 'u-b'] },
    ], 'u-a');
    expect(out).toEqual([
      { emoji: '👍', count: 1, user_ids: ['u-b'], me: false },
      { emoji: '❤️', count: 2, user_ids: ['u-a', 'u-b'], me: true },
    ]);
  });

  it('★ 古いサーバーが me を付けて送ってきても、user_ids があればそちらで決め直す', () => {
    const out = withMe([{ emoji: '👍', count: 1, user_ids: ['u-b'], me: true }], 'u-a');
    expect(out[0].me).toBe(false);
  });

  it('user_ids が無い (古いサーバー) ときは me を消す (付けた本人の目線の値を信じない)', () => {
    const out = withMe([{ emoji: '👍', count: 1, me: true }], 'u-a');
    expect(out[0].me).toBe(false);
  });
});
