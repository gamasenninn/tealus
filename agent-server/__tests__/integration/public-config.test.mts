/**
 * /public-config エンドポイントのテスト
 * 認証不要、resolved な TTS_PROVIDER を返す。
 */
import request from 'supertest';

jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  return { router: express.Router() };
});

import { app } from '../../src/app.mts';

describe('GET /public-config', () => {
  test('認証なしで tts_provider を返す', async () => {
    const res = await request(app).get('/public-config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tts_provider');
    expect(['browser', 'aivis-cloud', 'none']).toContain(res.body.tts_provider);
  });
});
