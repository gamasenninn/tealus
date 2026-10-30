/**
 * 鍵は正しいのに DB が答えられないときは 500 (401 にしない)
 *
 * ★ 2026-10-29 19:45 に本体が migrate より前に起動し、users の新しい列を読む SELECT が 25 秒失敗した。
 *   認証が「どんな例外も 401 トークンが無効です」にしていたので、画面は鍵が切れたと見てログイン画面へ落ち、
 *   無線の送り込みはログインし直しに失敗して終了した。DB の不調は 500 にして、クライアントにやり直させる
 */
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';

const mockQuery = jest.fn();
jest.mock('../../src/db/pool.mts', () => ({ pool: { query: (...args: unknown[]) => mockQuery(...args) } }));

import { authenticate, JWT_SECRET } from '../../src/middleware/auth.mts';
const query = mockQuery;

function run(token: string) {
  const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
  const res = { statusCode: 0, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  const next = jest.fn();
  return authenticate(req, res as unknown as Response, next).then(() => ({ res, next }));
}

describe('authenticate: DB の失敗と鍵の失敗を分ける', () => {
  beforeEach(() => query.mockReset());

  it('★★ 鍵は正しいが SELECT が失敗したら 500 (ログイン画面へ落とさない)', async () => {
    query.mockRejectedValue(new Error('column "must_change_password" does not exist'));
    const { res, next } = await run(jwt.sign({ id: 'u1' }, JWT_SECRET));
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('鍵が壊れていれば今までどおり 401', async () => {
    const { res } = await run('not-a-token');
    expect(res.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
