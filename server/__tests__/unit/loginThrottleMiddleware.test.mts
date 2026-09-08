/**
 * loginThrottle ミドルウェア (#362)
 *
 * ★ 経路が Cloudflare → NAS(nginx) → 本体 なので、そのままだと全通信が NAS の IP に見える。
 *   鍵が実質 login_id だけになり、**攻撃者が正規利用者を締め出せる**。
 *   express の `trust proxy` を入れて req.ip を実物にする前提で組む。
 */
import { createLoginThrottleMiddleware } from '../../src/middleware/loginThrottle.mts';
import { createLoginThrottle, keyOf } from '../../src/services/loginThrottle.mts';

interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(c: number): FakeRes;
  json(b: unknown): FakeRes;
  set(k: string, v: string): FakeRes;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
    set(k, v) { res.headers[k] = v; return res; },
  };
  return res;
}

const req = (ip: string, loginId: unknown) => ({ ip, body: { login_id: loginId } } as never);

function setup(overrides = {}) {
  let t = 1_000_000;
  const throttle = createLoginThrottle({ maxFailures: 3, windowMs: 60_000, now: () => t, ...overrides });
  const mw = createLoginThrottleMiddleware({ throttle });
  return { throttle, mw, advance: (ms: number) => { t += ms; } };
}

describe('通す / 塞ぐ', () => {
  test('失敗が上限未満なら next() を呼ぶ', () => {
    const { mw } = setup();
    const res = fakeRes();
    let called = false;
    mw(req('1.2.3.4', 'EMP001'), res as never, () => { called = true; });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  test('上限に達したら 429 を返し、next() を呼ばない', () => {
    const { mw, throttle } = setup();
    const r = req('1.2.3.4', 'EMP001');
    for (let i = 0; i < 3; i += 1) throttle.recordFailure(keyOf('1.2.3.4', 'EMP001'));
    const res = fakeRes();
    let called = false;
    mw(r, res as never, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(429);
  });

  test('★ 429 のときは Retry-After を付ける', () => {
    const { mw, throttle } = setup();
    for (let i = 0; i < 3; i += 1) throttle.recordFailure(keyOf('1.2.3.4', 'EMP001'));
    const res = fakeRes();
    mw(req('1.2.3.4', 'EMP001'), res as never, () => {});
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  test('★ 429 の本文で「その ID が存在するか」を漏らさない', () => {
    const { mw, throttle } = setup();
    for (let i = 0; i < 3; i += 1) throttle.recordFailure(keyOf('1.2.3.4', 'EMP001'));
    const res = fakeRes();
    mw(req('1.2.3.4', 'EMP001'), res as never, () => {});
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('EMP001');
    expect(text).not.toMatch(/存在|見つ|not.?found/i);
  });
});

describe('★ 塞いだリクエストは bcrypt に届かない (これが目的)', () => {
  test('429 のときハンドラは呼ばれない = bcrypt を踏まない', () => {
    const { mw, throttle } = setup();
    for (let i = 0; i < 3; i += 1) throttle.recordFailure(keyOf('1.2.3.4', 'EMP001'));
    let handlerRan = false;
    mw(req('1.2.3.4', 'EMP001'), fakeRes() as never, () => { handlerRan = true; });
    expect(handlerRan).toBe(false);
  });
});

describe('壊れた入力で落ちない (公開されている口)', () => {
  test.each([
    ['login_id が無い', undefined],
    ['login_id が数値', 12345],
    ['login_id がオブジェクト', { $ne: null }],
    ['login_id が配列', ['a', 'b']],
    ['login_id が空文字', ''],
  ])('%s でも next() を呼び、例外を投げない', (_label, value) => {
    const { mw } = setup();
    let called = false;
    expect(() => mw(req('1.2.3.4', value), fakeRes() as never, () => { called = true; })).not.toThrow();
    expect(called).toBe(true);
  });

  test('★ 極端に長い login_id は鍵に使う長さを切り詰める (memory を伸ばされない)', () => {
    const { mw } = setup();
    const r = req('1.2.3.4', 'x'.repeat(100_000)) as unknown as { loginThrottleKey?: string };
    mw(r as never, fakeRes() as never, () => {});
    expect((r.loginThrottleKey as string).length).toBeLessThan(200);
  });
});

describe('記録の口', () => {
  test('recordFailure / recordSuccess を req から引ける', () => {
    const { mw, throttle } = setup();
    const r = req('1.2.3.4', 'EMP001') as unknown as { loginThrottleKey?: string };
    mw(r as never, fakeRes() as never, () => {});
    expect(typeof r.loginThrottleKey).toBe('string');
    throttle.recordFailure(r.loginThrottleKey as string);
    throttle.recordFailure(r.loginThrottleKey as string);
    throttle.recordFailure(r.loginThrottleKey as string);
    const res = fakeRes();
    mw(req('1.2.3.4', 'EMP001'), res as never, () => {});
    expect(res.statusCode).toBe(429); // 同じ鍵が引けている
  });
});
