/**
 * 画面のエラーの回数制限の表は、窓を過ぎた送り手を落とす (2026-10-29 改善ループ 23 回目)
 * ★ 以前は上書きするだけで消さず、認証の要らない口なので送り手 (ip) の数だけ増え続けた
 */
import { countClientError, clientErrorLimitSize, resetClientErrorLimits, CLIENT_ERROR_LIMIT } from '../../src/routes/clientErrors.mts';

describe('countClientError', () => {
  beforeEach(() => resetClientErrorLimits());

  test('★ 10 分を過ぎた送り手は、次に誰かが数えたときに表から消える', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 50; i++) countClientError(`ip:10.0.0.${i}`, t0);
    expect(clientErrorLimitSize()).toBe(50);
    countClientError('ip:10.0.1.1', t0 + 11 * 60 * 1000);
    expect(clientErrorLimitSize()).toBe(1);
  });

  test('窓の中で上限を超えたら false (今までどおり)', () => {
    for (let i = 0; i < CLIENT_ERROR_LIMIT; i++) expect(countClientError('u1', 0)).toBe(true);
    expect(countClientError('u1', 1)).toBe(false);
  });
});
