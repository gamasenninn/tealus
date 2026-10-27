/**
 * 本体からの webhook は投稿の本文を丸ごと載せる (改善ループ 19 回目)
 * ★ express.json の既定は 100KB。日本語は約 3 万 4 千字で 413 になり、本体は 4xx をやり直さないので AI が起動しなかった。
 *   本文の決まり (5 万字、日本語で約 15 万バイト) が入る大きさにする
 */
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  const router = express.Router();
  router.post('/', (req: { body: { message?: { content?: string } } }, res: { json: (b: unknown) => void }) => {
    res.json({ length: req.body?.message?.content?.length ?? 0 });
  });
  return { router };
});
jest.mock('../../src/context/settingsManager.mts', () => ({
  getAllSettings: jest.fn(() => ({})), saveSettings: jest.fn(), loadSettings: jest.fn(), getSetting: jest.fn((_k: string, d: unknown) => d),
}));

const { app } = require('../../src/app.mts');

describe('webhook の本文の大きさ', () => {
  it('★ 日本語 5 万字の投稿を受け取れる', async () => {
    const res = await request(app).post('/webhook').send({ event: 'message.created', message: { content: 'あ'.repeat(50_000) } });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(50_000);
  });
});
