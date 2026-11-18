/**
 * 権限の事実 (本体の /api/auth/authz) の形を、受け取る側で確かめる (改善ループ 72、#649 B-6)
 *
 * ★ 以前は `as AuthzFacts` で受けていた。判定は `room.member_role !== null` で「メンバーか」を決めるので、
 *   本体が列の名前を変えると undefined になり「メンバー」と読まれる (開く側に倒れる)。
 *   形が崩れていたら、聞けなかったときと同じく断る (安全側)
 */
import { parseAuthzFacts } from '../../src/lib/configAuthz.mts';

describe('parseAuthzFacts', () => {
  it('本体の今の形はそのまま通す', () => {
    expect(parseAuthzFacts({ user_id: 'u', role: 'user', room: null })).toEqual({ user_id: 'u', role: 'user', room: null });
    const withRoom = { user_id: 'u', role: 'admin', room: { id: 'r', type: 'group', member_role: 'member' } };
    expect(parseAuthzFacts(withRoom)).toEqual(withRoom);
    expect(parseAuthzFacts({ ...withRoom, room: { ...withRoom.room, member_role: null } })?.room?.member_role).toBeNull();
  });

  it('★ member_role が無い (列の名前が変わった) なら null を返す (= 断る。「メンバー」に倒さない)', () => {
    expect(parseAuthzFacts({ user_id: 'u', role: 'user', room: { id: 'r', type: 'group', role: 'member' } })).toBeNull();
  });

  it('形の崩れたものは null', () => {
    for (const bad of [null, 'x', {}, { user_id: 'u' }, { user_id: 'u', role: 1, room: null }, { user_id: 'u', role: 'user', room: { id: 'r' } }]) {
      expect(parseAuthzFacts(bad)).toBeNull();
    }
  });
});
