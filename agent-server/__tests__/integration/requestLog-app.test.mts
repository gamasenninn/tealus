/**
 * 「誰が」の記録 (改善ループ 9 回目の B・C) が、agent-server の本物の app (app.mts) に組み込まれていること (2026-10-23)
 *
 * ★ 改善ループ 10 回目の L: 既存の requestLog.test は自作の express に部品を生やして確かめるだけで、
 *   app.mts の配線 (express.json の後・各口の前に置く) が外れても緑のままだった
 */
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reqlog-app-'));
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
const { logger } = require('../../src/lib/logger.mts') as { logger: { warn: jest.Mock } };
const settle = () => new Promise((r) => setImmediate(r));

test('鍵の無い /cc-queue の要求は [http-denied] 401 として本物の app に残る', async () => {
  logger.warn.mockClear();
  const res = await request(app).get('/cc-queue/pending?project=x').set('User-Agent', 'cc-stream-test');
  expect(res.status).toBe(401);
  await settle();
  const lines = logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[http-denied]'));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('401 GET /cc-queue/pending');
  expect(lines[0]).toContain('ua=cc-stream-test');
  expect(lines[0]).not.toContain('project=x');   // 問い合わせは残さない
});
