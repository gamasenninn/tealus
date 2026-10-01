/**
 * /agent-api は webhook の受け口を中継しない (2026-10-01)
 *
 * ★ 本体は webhook を agent-server へ直接 (localhost:4000) 送る。外からの中継を通る必要はない
 * ★ 中継先は誰も listen していない port にしてから app を読む (本番の agent-server に飛ばさない)
 */
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(() => {
  // ★ app.mts は読み込んだ時点で AGENT_PORT を読む。import でなく、env を入れてから require する (docs/05 §2a)
  process.env.AGENT_PORT = '1';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ app } = require('../../src/app.mts') as { app: Express });
});

describe('/agent-api の webhook', () => {
  it.each([
    '/agent-api/webhook/tealus',
    '/agent-api/webhook/',
    '/agent-api/webhook',
    '/agent-api//webhook/tealus',
    '/agent-api/Webhook/tealus',
    '/agent-api/%77ebhook/tealus',
  ])('★ %s は中継しない (404)', async (path) => {
    const res = await request(app).post(path).send({ event: 'message.created' });
    expect(res.status).toBe(404);
  });

  it('他の口はこれまでどおり中継する (上流がいないので 504)', async () => {
    const res = await request(app).get('/agent-api/identity');
    expect(res.status).toBe(504);
  });
});
