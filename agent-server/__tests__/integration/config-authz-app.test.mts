/**
 * #458 ★ 設定 API の権限が **アプリに組み込まれていること** (部品のテストが通っても、使われていなければ守りにならない)
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-authz-app-'));
process.env.AGENT_CONFIG_DIR = tmpConfigDir;
process.env.AGENT_MCP_CONFIG_PATH = path.join(tmpConfigDir, 'mcp_config.json');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
afterAll(() => {
  delete process.env.AGENT_CONFIG_DIR;
  delete process.env.AGENT_MCP_CONFIG_PATH;
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
});

jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  return { router: express.Router() };
});
jest.mock('../../src/context/settingsManager.mts', () => ({
  getAllSettings: jest.fn(() => ({ max_turns: 3 })), saveSettings: jest.fn(), loadSettings: jest.fn(), getSetting: jest.fn((_k: string, d: unknown) => d),
}));

// ★ 本体への問い合わせ (GET /api/auth/authz) を偽物に。鍵ごとに役割を変える
const roles: Record<string, string> = {};
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    if (u.includes('/api/auth/authz')) {
      const tok = (init?.headers?.Authorization || '').slice(7);
      const uid = (jwt.decode(tok) as { id: string }).id;
      return { ok: true, status: 200, json: async () => ({ user_id: uid, role: roles[uid] || 'user', room: null }) } as Response;
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });

const { app } = require('../../src/app.mts');
const tokenOf = (id: string) => jwt.sign({ id, login_id: id }, process.env.JWT_SECRET!, { expiresIn: '1h' });

describe('#458 /config の権限がアプリに組み込まれている', () => {
  test('★★ 一般の利用者は全体の設定で 403', async () => {
    const res = await request(app).get('/config/settings').set('Authorization', `Bearer ${tokenOf('u-user')}`);
    expect(res.status).toBe(403);
  });

  test('★ システム管理者は通る', async () => {
    roles['u-admin'] = 'admin';
    const res = await request(app).get('/config/settings').set('Authorization', `Bearer ${tokenOf('u-admin')}`);
    expect(res.status).toBe(200);
  });

  test('★ 声の一覧 (tts-options) はログインだけで取れる', async () => {
    const res = await request(app).get('/config/tts-options').set('Authorization', `Bearer ${tokenOf('u-user2')}`);
    expect(res.status).toBe(200);
  });

  test('鍵なしは 401 (今までどおり)', async () => {
    const res = await request(app).get('/config/settings');
    expect(res.status).toBe(401);
  });
});
