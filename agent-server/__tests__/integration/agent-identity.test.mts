/**
 * #338 Phase 1: GET /agent/identity 統合テスト
 *
 * アプリ内アシスタント (Light/Deep) の identity (user_id / display_name) を返す。
 * クライアントの「エージェントに送る」compose ヘルパーが、正しい宛先メンション
 * (@<display_name>) を組み立てるのに使う。identity は起動時の registerBotUserId で
 * 確定するため、本 test では register を呼んでから endpoint を叩く。
 */
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// webhook/routes は重い依存を引くので空 router に mock (cc-projects.test と同方針)
jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  return { router: express.Router() };
});

const { app } = require('../../src/app.mts') as { app: import('express').Express };
const { registerBotUserId } = require('../../src/webhook/handler.mts') as {
  registerBotUserId: (userId: string, displayName?: string, rooms?: Array<{ id: string }>) => void;
};

function makeToken(): string {
  return jwt.sign({ id: 'u1', login_id: 'EMP001' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
}

describe('GET /agent/identity', () => {
  test('認証なし → 401', async () => {
    const res = await request(app).get('/agent/identity');
    expect(res.status).toBe(401);
  });

  test('登録済み identity (user_id / display_name) を返す', async () => {
    registerBotUserId('bot-uuid-123', 'アシスタント', [{ id: 'room1' }]);

    const res = await request(app)
      .get('/agent/identity')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user_id: 'bot-uuid-123', display_name: 'アシスタント' });
  });
});
