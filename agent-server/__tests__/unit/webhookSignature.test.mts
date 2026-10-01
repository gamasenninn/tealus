/**
 * webhook の受け口の署名検査 (2026-10-01)
 *
 * ★ 以前は「署名が付いているときだけ」検査していた。署名を付けなければ素通りだった
 * ★ 鍵が設定されているなら、署名の無い・合わない便は受け取らない (処理も呼ばない)
 * ★ 鍵が無い設定は、以前どおり受け取る (採用者の既存の設定を黙って止めない。起動時に警告する)
 */
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));
jest.mock('../../src/webhook/handler.mts', () => ({ handleWebhook: jest.fn(async () => {}) }));

import { createWebhookRouter } from '../../src/webhook/routes.mts';

const SECRET = 'test-secret-for-signature';
const body = { event: 'message.created', data: { message: { id: 'm1' } } };
const sign = (secret: string, payload: unknown) =>
  `sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')}`;

function appWith(secret: string) {
  const handle = jest.fn(async (_b: unknown) => {});
  const app = express();
  app.use(express.json());
  app.use('/webhook', createWebhookRouter({ secret, handle }));
  return { app, handle };
}

describe('鍵が設定されているとき', () => {
  it('正しい署名なら受け取って処理する', async () => {
    const { app, handle } = appWith(SECRET);
    const res = await request(app).post('/webhook/tealus').set('X-Tealus-Signature', sign(SECRET, body)).send(body);
    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('★ 署名が無ければ 401 (処理しない)', async () => {
    const { app, handle } = appWith(SECRET);
    const res = await request(app).post('/webhook/tealus').send(body);
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it('★ 違う鍵の署名なら 401 (処理しない)', async () => {
    const { app, handle } = appWith(SECRET);
    const res = await request(app).post('/webhook/tealus').set('X-Tealus-Signature', sign('other', body)).send(body);
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it('★ 形の崩れた署名でも 401 (落ちない)', async () => {
    const { app, handle } = appWith(SECRET);
    for (const sig of ['sha256=', 'sha256=zz', 'garbage', sign(SECRET, body) + '00']) {
      const res = await request(app).post('/webhook/tealus').set('X-Tealus-Signature', sig).send(body);
      expect(res.status).toBe(401);
    }
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('鍵が無い設定', () => {
  it('以前どおり受け取る (既存の採用者の設定を止めない)', async () => {
    const { app, handle } = appWith('');
    const res = await request(app).post('/webhook/tealus').send(body);
    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
