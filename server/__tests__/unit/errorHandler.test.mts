/**
 * #603 想定外の失敗 (next(err) / 投げられた例外) を、中身を出さずに返す。
 *
 * ★ 以前はエラー用の受け口が無く、Express の既定の返事になっていた。本番の設定が NODE_ENV=development だったので、
 *   本文にスタック (本体の中のパス) が入る形だった (例: /media の判定で DB が落ちたとき、#601)
 * ★ NODE_ENV に頼らず、いつも同じ返し方にする
 */
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/middleware/errorHandler.mts';
import { app as realApp } from '../../src/app.mts';
import * as E from '../../src/constants/errors.mts';

function appThatFails(err: unknown) {
  const a = express();
  a.get('/boom', (_req, _res, next) => next(err));
  a.get('/throw', () => { throw err; });
  a.use(errorHandler);
  return a;
}

describe('errorHandler (#603)', () => {
  it('★★ 想定外の失敗は 500 と決まった文だけを返す (スタック・パスを出さない)', async () => {
    const err = new Error('connect ECONNREFUSED C:\app\tealus\server\src\db');
    for (const path of ['/boom', '/throw']) {
      const res = await request(appThatFails(err)).get(path);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: E.SERVER_ERROR });
      expect(res.text).not.toMatch(/ECONNREFUSED|\app\|at /);
    }
  });

  it('★ 状態の番号を持つ失敗 (本文が大きすぎる 413 など) はその番号を保つ', async () => {
    const res = await request(appThatFails(Object.assign(new Error('too large'), { status: 413 }))).get('/boom');
    expect(res.status).toBe(413);
    expect(res.text).not.toMatch(/too large/);
  });

  it('★★ 本体の app の最後に付いている', () => {
    const stack = (realApp as unknown as { _router: { stack: { handle: unknown }[] } })._router.stack;
    expect(stack[stack.length - 1].handle).toBe(errorHandler);
  });
});
