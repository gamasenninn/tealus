/**
 * 改善ループ 9 回目の B・C (agent-server 側)。
 *
 * ★ C: /cc-queue や /voice-chat の 401 は、どこにも記録されなかった (採用者の受け取りが止まっても、誰の鍵が切れたか言えない)
 * ★ B: 部屋の AI の指示文・MCP の設定 (/config) を書き換えても、誰が変えたかが残らなかった
 */
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const JWT_SECRET = process.env.JWT_SECRET;

import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
// ★ JWT_SECRET を決めてから読む (auth.test.mts と同じ理由)
const { authenticate } = require('../../src/middleware/auth.mts') as { authenticate: RequestHandler };
const { requestLog } = require('../../src/middleware/requestLog.mts') as { requestLog: RequestHandler };
const { logger } = require('../../src/lib/logger.mts') as { logger: { warn: (...a: unknown[]) => unknown; info: (...a: unknown[]) => unknown } };

const USER_ID = 'abcdef12-0000-0000-0000-000000000000';
const token = () => jwt.sign({ id: USER_ID, login_id: 'tester' }, JWT_SECRET, { expiresIn: '1h' });

let app: express.Express;
let warn: ReturnType<typeof jest.spyOn>;
let info: ReturnType<typeof jest.spyOn>;
const lines = (spy: ReturnType<typeof jest.spyOn>, prefix: string): string[] =>
  (spy.mock.calls as unknown[][]).map((c) => String(c[0])).filter((s) => s.startsWith(prefix));
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  app = express();
  app.use(express.json());
  app.use(requestLog);
  app.get('/cc-queue/pending', authenticate, (_req, res) => { res.json({ count: 0 }); });
  app.put('/config/rooms/:id/light-prompt', authenticate, (_req, res) => { res.json({ ok: true }); });
  app.post('/webhook', (_req, res) => { res.json({ ok: true }); });
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
});
afterEach(() => { warn.mockRestore(); info.mockRestore(); });

describe('agent-server の要求の記録', () => {
  test('401 は ua と ip を添えて残す (問い合わせは残さない)', async () => {
    const res = await request(app).get('/cc-queue/pending?project=x&token=secret-value').set('User-Agent', 'cc-main');
    expect(res.status).toBe(401);
    await settle();
    const l = lines(warn, '[http-denied]');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatch(/^\[http-denied\] 401 GET \/cc-queue\/pending user=- ip=\S+ ua=cc-main$/);
    expect(l[0]).not.toContain('secret-value');
  });

  test('設定の書き換えは、誰が・どこを・どの欄を残す (値は残さない)', async () => {
    const res = await request(app).put('/config/rooms/r1/light-prompt')
      .set('Authorization', `Bearer ${token()}`).send({ prompt: 'ひみつの指示' });
    expect(res.status).toBe(200);
    await settle();
    const l = lines(info, '[change]');
    expect(l).toHaveLength(1);
    expect(l[0]).toBe('[change] PUT /config/rooms/r1/light-prompt 200 by=abcdef12 fields=prompt');
  });

  test('webhook (本体からの定期便) は変更として残さない', async () => {
    await request(app).post('/webhook').send({ event: 'message.created' });
    await settle();
    expect(lines(info, '[change]')).toHaveLength(0);
  });

  test('通った読み取りは何も残さない', async () => {
    await request(app).get('/cc-queue/pending').set('Authorization', `Bearer ${token()}`);
    await settle();
    expect(lines(warn, '[http-denied]')).toHaveLength(0);
    expect(lines(info, '[change]')).toHaveLength(0);
  });
});
