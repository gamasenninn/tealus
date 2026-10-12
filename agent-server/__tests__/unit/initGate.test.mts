/**
 * #589 起動時の初期化の待ち合わせ。
 * ★ 試し直しの待ち (最長 60 秒) の間に webhook が届いたら、待ちを起こしてすぐ試し直す
 *   (webhook が届いた = 本体は上がっている)。届いた投稿は、つながるのを少し待ってから処理する
 */
import { sleepUnlessKicked, kickInitRetry, whenAgentReady, markAgentReady, isAgentReady, resetInitGateForTest } from '../../src/lib/initGate.mts';

beforeEach(() => resetInitGateForTest());

describe('#589 initGate', () => {
  test('★ 試し直しの待ちは、kick で早く終わる', async () => {
    const t0 = Date.now();
    const p = sleepUnlessKicked(60_000);
    kickInitRetry();
    await p;
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('kick する待ちが無いときは何もしない (落ちない)', () => {
    expect(() => kickInitRetry()).not.toThrow();
  });

  test('★ つながったら、待っている側に true', async () => {
    const p = whenAgentReady(5_000);
    markAgentReady();
    await expect(p).resolves.toBe(true);
    expect(isAgentReady()).toBe(true);
  });

  test('つながらないまま時間が来たら false', async () => {
    await expect(whenAgentReady(20)).resolves.toBe(false);
  });

  test('すでにつながっていれば待たずに true', async () => {
    markAgentReady();
    await expect(whenAgentReady(5_000)).resolves.toBe(true);
  });
});

