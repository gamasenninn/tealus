/**
 * 想定外の失敗の受け口が agent-server の本物の app (app.mts) にあること (セキュリティチェックループ 1 回目、2026-10-26)
 *
 * ★ 受け口が無いと Express の既定の返事になり、NODE_ENV が無い (= development) と本文に中のパスが入る。
 *   本体は #603 で塞いだが、agent-server には同じものが無かった
 */
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'errh-app-'));
process.env.AGENT_CONFIG_DIR = tmpRoot;
process.env.AGENT_MCP_CONFIG_PATH = path.join(tmpRoot, 'mcp_config.json');
process.env.AGENT_WORKSPACE_ROOT = path.join(tmpRoot, 'ws');
process.env.CC_QUEUE_DIR = path.join(tmpRoot, 'cc-queue');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  return { router: express.Router() };
});

const { app } = require('../../src/app.mts') as { app: import('express').Express };

test('壊れた JSON は 400 のまま、決まった JSON で返し、中のパスやスタックを出さない', async () => {
  const res = await request(app).post('/config').set('Content-Type', 'application/json').send('{');
  expect(res.status).toBe(400);
  expect(res.headers['content-type']).toMatch(/json/);
  expect(res.text).not.toMatch(/SyntaxError|node_modules|at parse|<pre>/);
});
