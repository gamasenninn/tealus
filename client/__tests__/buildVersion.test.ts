import { describe, it, expect } from 'vitest';
import { isStale } from '../src/utils/buildVersion';

/**
 * #356 「自分は古いか」の判定。
 *
 * 誤検知の代償が大きい (更新バナーが出っぱなしになる) ので、確信が持てないときは
 * 必ず false に倒す。判定材料が揃って、かつ明確に食い違うときだけ true。
 */

describe('isStale', () => {
  it('サーバの ID と食い違えば古い', () => {
    expect(isStale('2026-07-28 17:45 a17292d', '2026-07-28 19:10 b33ff01')).toBe(true);
  });

  it('一致していれば古くない', () => {
    expect(isStale('2026-07-28 17:45 a17292d', '2026-07-28 17:45 a17292d')).toBe(false);
  });

  it('サーバが不明 (null) なら判定しない — 未ビルドの dev サーバ等', () => {
    expect(isStale('2026-07-28 17:45 a17292d', null)).toBe(false);
  });

  it('自分が不明なら判定しない — dev では __BUILD_ID__ が焼き込まれない', () => {
    expect(isStale(null, '2026-07-28 19:10 b33ff01')).toBe(false);
    expect(isStale(undefined, '2026-07-28 19:10 b33ff01')).toBe(false);
  });

  it('空文字は不明として扱う', () => {
    expect(isStale('', '2026-07-28 19:10 b33ff01')).toBe(false);
    expect(isStale('2026-07-28 17:45 a17292d', '')).toBe(false);
  });

  it('両方不明なら判定しない', () => {
    expect(isStale(null, null)).toBe(false);
  });

  it('前後の空白差だけなら古くない (JSON 整形の揺れで誤検知しない)', () => {
    expect(isStale(' 2026-07-28 17:45 a17292d ', '2026-07-28 17:45 a17292d')).toBe(false);
  });
});
