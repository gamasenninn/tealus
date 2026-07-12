/**
 * #253: GET /agent/cc-projects 統合テスト
 *
 * cc-queue ディレクトリの jsonl basename を project list として返す事を verify。
 * mockTmpDir + DEFAULT_QUEUE_DIR の env override は ccQueue.js が module 定数で
 * 直 export してるため、本 test では一時 dir を作って fs を直接観察する形にする。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  return { router: express.Router() };
});

// DEFAULT_QUEUE_DIR を mockTmpDir に向けるため module を mock
// jest.mock の factory closure 制約により変数名は mock prefix 必須
const mockTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-projects-test-'));
jest.mock('../../src/webhook/ccQueue.mts', () => {
  const actual = jest.requireActual('../../src/webhook/ccQueue.mts');
  return { ...actual, DEFAULT_QUEUE_DIR: mockTmpDir };
});

// ESM では import が巻き上げられ評価される。static import だと app.mts (→ webhook/ccQueue.mts)
// の module-load が下の mockTmpDir 初期化より先に走り、mock factory から参照する mockTmpDir が
// TDZ になる ("Cannot access 'mockTmpDir' before initialization")。require で遅延読込にする。
const { app } = require('../../src/app.mts') as { app: import('express').Express };

function makeToken(): string {
  return jwt.sign({ id: 'u1', login_id: 'EMP001' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
}

describe('GET /agent/cc-projects', () => {
  beforeEach(() => {
    // Each test starts with empty dir
    for (const f of fs.readdirSync(mockTmpDir)) {
      fs.unlinkSync(path.join(mockTmpDir, f));
    }
  });

  afterAll(() => {
    fs.rmSync(mockTmpDir, { recursive: true, force: true });
  });

  test('認証なし → 401', async () => {
    const res = await request(app).get('/agent/cc-projects');
    expect(res.status).toBe(401);
  });

  test('queue dir が空 → projects=[]', async () => {
    const res = await request(app)
      .get('/agent/cc-projects')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
  });

  test('jsonl 複数 → name で sort されて返る', async () => {
    fs.writeFileSync(path.join(mockTmpDir, 'tealus.jsonl'), '{}\n');
    fs.writeFileSync(path.join(mockTmpDir, 'aaa.jsonl'), '{}\n');
    fs.writeFileSync(path.join(mockTmpDir, 'middle.jsonl'), '{}\n');

    const res = await request(app)
      .get('/agent/cc-projects')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(['aaa', 'middle', 'tealus']);
    for (const p of res.body.projects) {
      expect(typeof p.mtime_ms).toBe('number');
      expect(p.mtime_ms).toBeGreaterThan(0);
    }
  });

  test('非 jsonl file は無視', async () => {
    fs.writeFileSync(path.join(mockTmpDir, 'tealus.jsonl'), '{}\n');
    fs.writeFileSync(path.join(mockTmpDir, 'README.md'), '# notes\n');
    fs.writeFileSync(path.join(mockTmpDir, 'config.json'), '{}\n');

    const res = await request(app)
      .get('/agent/cc-projects')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(['tealus']);
  });

  test('invalid な project 名 (regex 不一致) は除外', async () => {
    fs.writeFileSync(path.join(mockTmpDir, 'tealus.jsonl'), '{}\n');
    fs.writeFileSync(path.join(mockTmpDir, 'INVALID_UPPER.jsonl'), '{}\n');
    fs.writeFileSync(path.join(mockTmpDir, '-bad-leading.jsonl'), '{}\n');
    fs.writeFileSync(path.join(mockTmpDir, 'has space.jsonl'), '{}\n');

    const res = await request(app)
      .get('/agent/cc-projects')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(['tealus']);
  });
});
