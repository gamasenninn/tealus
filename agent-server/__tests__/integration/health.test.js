/**
 * ヘルスチェックのテスト
 * app.js を使う（index.js の app.listen を回避）
 */
const request = require('supertest');

jest.mock('../../src/webhook/routes', () => {
  const express = require('express');
  return express.Router();
});

const { app } = require('../../src/app');

describe('Health Check', () => {
  test('GET /health が200を返す', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('tealus-agent-server');
  });
});
