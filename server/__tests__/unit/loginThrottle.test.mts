/**
 * loginThrottle ユニットテスト (#362)
 *
 * ★ 数えるのは「失敗」だけ。成功は数えない。
 *   総当たり攻撃は失敗の連打だが、cc-bridge の 55 分ごとの login は必ず成功する。
 *   全リクエストを数える素直なレート制限だと bot 例外が要り、issue が警戒したとおり
 *   例外の方が恒久化する。失敗だけ数えれば、bot はそもそも当たらない。
 *
 * 純粋関数・時計注入。DB 非依存。
 */
import * as mod from '../../src/services/loginThrottle.mts';

/** 時計を手で進めるための道具 */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('失敗の数え方', () => {
  test('上限未満の失敗では通す', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 4; i += 1) th.recordFailure('1.2.3.4|EMP001');
    expect(th.check('1.2.3.4|EMP001').blocked).toBe(false);
  });

  test('上限に達したら塞ぐ', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 5; i += 1) th.recordFailure('1.2.3.4|EMP001');
    expect(th.check('1.2.3.4|EMP001').blocked).toBe(true);
  });

  test('塞いだときは、あと何秒待てばよいかを返す', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 5; i += 1) th.recordFailure('k');
    c.advance(300_000); // 5 分経過
    const r = th.check('k');
    expect(r.blocked).toBe(true);
    expect(r.retryAfterSec).toBe(600); // 残り 10 分
  });
});

describe('★ 成功は数えない (cc-bridge が自分を締め出さないための中心的な約束)', () => {
  test('成功したら、それまでの失敗を消す', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 4; i += 1) th.recordFailure('k');
    th.recordSuccess('k');
    for (let i = 0; i < 4; i += 1) th.recordFailure('k');
    expect(th.check('k').blocked).toBe(false); // 消えていなければ 8 回目で塞がる
  });

  test('★ 成功だけを何回繰り返しても塞がらない (55 分周期 × 何日でも)', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 500; i += 1) { th.recordSuccess('bridge'); c.advance(55 * 60_000); }
    expect(th.check('bridge').blocked).toBe(false);
  });
});

describe('窓', () => {
  test('窓を過ぎた失敗は数えない', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 5; i += 1) th.recordFailure('k');
    expect(th.check('k').blocked).toBe(true);
    c.advance(900_001);
    expect(th.check('k').blocked).toBe(false);
  });

  test('窓の中に散らばった失敗は積み上がる (窓は滑る)', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 5; i += 1) { th.recordFailure('k'); c.advance(100_000); } // 計 500 秒
    expect(th.check('k').blocked).toBe(true);
  });
});

describe('鍵の分け方', () => {
  test('同じ IP でも login_id が違えば別に数える', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 5; i += 1) th.recordFailure('1.2.3.4|EMP001');
    expect(th.check('1.2.3.4|EMP002').blocked).toBe(false);
  });

  test('同じ login_id でも IP が違えば別に数える', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 5; i += 1) th.recordFailure('1.2.3.4|EMP001');
    expect(th.check('9.9.9.9|EMP001').blocked).toBe(false);
  });

  test('keyOf は IP と login_id を分けて綴じる (区切り文字の混入で衝突しない)', () => {
    expect(mod.keyOf('1.2.3.4', 'a|b')).not.toBe(mod.keyOf('1.2.3.4|a', 'b'));
  });
});

describe('★ 際限なく溜まらない (公開されている口なので、鍵は攻撃者が自由に作れる)', () => {
  test('窓を過ぎた鍵は掃除で消える', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, now: c.now });
    for (let i = 0; i < 1000; i += 1) th.recordFailure(`ip${i}|EMP001`);
    expect(th.size()).toBe(1000);
    c.advance(900_001);
    th.prune();
    expect(th.size()).toBe(0);
  });

  test('掃除しなくても、上限を超えたら古い鍵から落とす', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, maxKeys: 100, now: c.now });
    for (let i = 0; i < 500; i += 1) th.recordFailure(`ip${i}|EMP001`);
    expect(th.size()).toBeLessThanOrEqual(100);
  });

  test('★ 古い鍵から落とすとき、いま塞いでいる鍵を巻き添えにしない', () => {
    const c = fakeClock();
    const th = mod.createLoginThrottle({ maxFailures: 5, windowMs: 900_000, maxKeys: 10, now: c.now });
    for (let i = 0; i < 5; i += 1) th.recordFailure('attacker');   // 塞がっている
    c.advance(1000);
    for (let i = 0; i < 50; i += 1) th.recordFailure(`noise${i}`); // 溢れさせる
    expect(th.check('attacker').blocked).toBe(true);
  });
});
