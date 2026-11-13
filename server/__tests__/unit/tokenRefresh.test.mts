/**
 * 鍵 (JWT) を使っている間に延ばす。ただし最初のログインから 30 日で入り直し
 * (2026-11-12 小野さん判断、docs/05 §5)。
 * ★ それまでは 7 日で切れて延ばす口が無く、毎日使う人も週 1 回入り直していた
 */
import jwt from 'jsonwebtoken';
import { generateToken, refreshTokenIfDue, JWT_SECRET, resetRefreshedTokenCache } from '../../src/middleware/auth.mts';

// ★ 改善ループ 50: 同じ鍵からは同じ新しい鍵を返す (キャッシュ) ので、テストの順番に左右されないよう毎回空にする
beforeEach(() => resetRefreshedTokenCache());

const DAY = 24 * 60 * 60;
const user = { id: 'u-1', login_id: 'taro' };

/** now (秒) の時点で発行された鍵の中身を作る */
function claims(over: Record<string, number>): { id: string; login_id: string; iat: number; exp: number; auth_at?: number } {
  return { id: user.id, login_id: user.login_id, iat: 0, exp: 0, ...over };
}

describe('generateToken', () => {
  test('★ ログインのときは最初のログインの時刻 (auth_at) を入れ、期限は 7 日', () => {
    const before = Math.floor(Date.now() / 1000);
    const d = jwt.verify(generateToken(user), JWT_SECRET) as { auth_at: number; iat: number; exp: number };
    expect(d.auth_at).toBeGreaterThanOrEqual(before);
    expect(d.exp - d.iat).toBe(7 * DAY);
  });
});

describe('refreshTokenIfDue', () => {
  const now = 1_800_000_000;

  test('★ 残りが半分 (3.5 日) を切ったら、auth_at を引き継いだ新しい 7 日の鍵を返す', () => {
    const authAt = now - 10 * DAY;
    const t = refreshTokenIfDue(claims({ iat: now - 5 * DAY, exp: now + 2 * DAY, auth_at: authAt }), now);
    expect(t).not.toBeNull();
    const d = jwt.verify(t!, JWT_SECRET, { clockTimestamp: now }) as { id: string; login_id: string; auth_at: number; exp: number };
    expect(d.id).toBe(user.id);
    expect(d.login_id).toBe(user.login_id);
    expect(d.auth_at).toBe(authAt);
    expect(d.exp).toBe(now + 7 * DAY);
  });

  test('残りが半分より多ければ返さない (毎回作り直さない)', () => {
    expect(refreshTokenIfDue(claims({ iat: now - 1 * DAY, exp: now + 6 * DAY, auth_at: now - 1 * DAY }), now)).toBeNull();
  });

  test('★ 期限は最初のログインから 30 日を超えない', () => {
    const authAt = now - 27 * DAY;
    const t = refreshTokenIfDue(claims({ iat: now - 5 * DAY, exp: now + 2 * DAY, auth_at: authAt }), now);
    const d = jwt.verify(t!, JWT_SECRET, { clockTimestamp: now }) as { exp: number };
    expect(d.exp).toBe(authAt + 30 * DAY);
  });

  test('★ 30 日の上限に達していて延びないなら返さない (入り直しになる)', () => {
    const authAt = now - 29 * DAY;
    // 今の期限がちょうど 30 日の上限
    expect(refreshTokenIfDue(claims({ iat: now - 6 * DAY, exp: authAt + 30 * DAY, auth_at: authAt }), now)).toBeNull();
  });

  test('★ auth_at の無い古い鍵は iat を最初のログインとみなす (移行の日に入り直しは起きない)', () => {
    const iat = now - 5 * DAY;
    const t = refreshTokenIfDue(claims({ iat, exp: now + 2 * DAY }), now);
    const d = jwt.verify(t!, JWT_SECRET, { clockTimestamp: now }) as { auth_at: number; exp: number };
    expect(d.auth_at).toBe(iat);
    expect(d.exp).toBe(now + 7 * DAY);
  });
});

/**
 * 改善ループ 49: 同じ鍵からは同じ新しい鍵を返す (ボットは X-Refreshed-Token を読まず古い鍵で要求し続けるので、
 * 毎回署名し直し・ログを書いていた。EC窓口は 1 日 13 万要求)
 */
describe('refreshTokenIfDue — 同じ鍵からは 1 回だけ作る (改善ループ 49)', () => {
  const now = 1_800_000_000;
  test('★ 同じ人・同じ期限の鍵なら、2 回目も同じ新しい鍵を返す', () => {
    const c = claims({ iat: now - 5 * DAY, exp: now + 2 * DAY, auth_at: now - 5 * DAY });
    const a = refreshTokenIfDue(c, now);
    const b = refreshTokenIfDue({ ...c }, now + 60);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });
});
