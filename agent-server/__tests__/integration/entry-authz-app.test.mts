/**
 * #459 ★ 「署名だけ」だった入口の守りが **アプリに組み込まれていること**
 *   (部品のテストが通っても、使われていなければ守りにならない —— #458 と同じ確かめ方)
 *
 * ★ 一般の利用者の鍵で:
 *   /logs                  403 (ログには全ルームの本文が入る)
 *   /agent/cancel          入っていないルームは 403
 *   /cc-queue/gateway-bye  403 (呼べるのは本体サーバの鍵だけ。一般の鍵で全購読者の警報を黙らせない)
 *   /voice-chat/log        session_id がファイル名になる → 形の違うものは 400 (★ ../ で任意の .jsonl に追記できた)
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-authz-app-'));
process.env.AGENT_CONFIG_DIR = tmpRoot;
process.env.AGENT_MCP_CONFIG_PATH = path.join(tmpRoot, 'mcp_config.json');
process.env.AGENT_WORKSPACE_ROOT = path.join(tmpRoot, 'ws');
process.env.CC_QUEUE_DIR = path.join(tmpRoot, 'cc-queue');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
afterAll(() => {
  delete process.env.AGENT_CONFIG_DIR;
  delete process.env.AGENT_MCP_CONFIG_PATH;
  delete process.env.CC_QUEUE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/webhook/routes.mts', () => {
  const express = require('express');
  return { router: express.Router() };
});

// ★ 本体への問い合わせ (GET /api/auth/authz) を偽物に。鍵ごとに役割、ルームごとに参加を変える
const roles: Record<string, string> = {};
const members: Record<string, string[]> = { r1: ['u-member'] };
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/auth/authz') {
      const tok = (init?.headers?.Authorization || '').slice(7);
      const uid = (jwt.decode(tok) as { id: string }).id;
      const roomId = u.searchParams.get('room_id');
      const room = roomId
        ? { id: roomId, type: 'group', member_role: (members[roomId] || []).includes(uid) ? 'member' : null }
        : null;
      return { ok: true, status: 200, json: async () => ({ user_id: uid, role: roles[uid] || 'user', room }) } as Response;
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });

const { app } = require('../../src/app.mts');
const tokenOf = (id: string) => jwt.sign({ id, login_id: id }, process.env.JWT_SECRET!, { expiresIn: '1h' });
const auth = (id: string) => ({ Authorization: `Bearer ${tokenOf(id)}` });

describe('#459 /logs は管理者だけ', () => {
  test('★★ 一般の利用者は 403 (本文を返さない)', async () => {
    const res = await request(app).get('/logs').set(auth('u-user'));
    expect(res.status).toBe(403);
    expect(res.body.logs).toBeUndefined();
  });
  test('★ /logs/dates も 403', async () => {
    const res = await request(app).get('/logs/dates').set(auth('u-user'));
    expect(res.status).toBe(403);
  });
  test('システム管理者は通る', async () => {
    roles['u-admin'] = 'admin';
    const res = await request(app).get('/logs/dates').set(auth('u-admin'));
    expect(res.status).toBe(200);
  });
});

describe('#459 /agent', () => {
  test('identity はログインだけで取れる (今までどおり)', async () => {
    const res = await request(app).get('/agent/identity').set(auth('u-user'));
    expect(res.status).toBe(200);
  });
  test('★★ 入っていないルームの cancel は 403', async () => {
    const res = await request(app).post('/agent/cancel').set(auth('u-user')).send({ room_id: 'r1' });
    expect(res.status).toBe(403);
  });
  test('★ メンバーは cancel できる', async () => {
    const res = await request(app).post('/agent/cancel').set(auth('u-member')).send({ room_id: 'r1' });
    expect(res.status).toBe(200);
    expect(res.body.was_running).toBe(false);
  });
  test('room_id が無ければ 400 (今までどおり)', async () => {
    const res = await request(app).post('/agent/cancel').set(auth('u-user')).send({});
    expect(res.status).toBe(400);
  });
});

describe('#459 /cc-queue/gateway-bye は本体サーバの鍵だけ', () => {
  test('★★ 一般の利用者の鍵は 403', async () => {
    const res = await request(app).post('/cc-queue/gateway-bye').set(auth('u-user')).send({ expect_back_ms: 300000 });
    expect(res.status).toBe(403);
  });
  test('★ 本体サーバの鍵 (id=tealus-server) は通る', async () => {
    const res = await request(app).post('/cc-queue/gateway-bye').set(auth('tealus-server')).send({ expect_back_ms: 30000 });
    expect(res.status).toBe(200);
  });
});

describe('#459 /cc-queue/pending の project はファイル名の形だけ', () => {
  test('★★ ../ を含む project は 400 (本体に聞く前に断る)', async () => {
    const res = await request(app).get('/cc-queue/pending?project=../../ws/_voice-chat-logs/x').set(auth('u-user'));
    expect(res.status).toBe(400);
  });
});

describe('#459 /voice-chat/log の session_id', () => {
  test('★★ ../ を含む session_id は 400、置き場の外にファイルができない', async () => {
    const escaped = path.join(tmpRoot, 'cc-queue', 'tealus.jsonl');
    const res = await request(app).post('/voice-chat/log').set(auth('u-user'))
      .send({ session_id: '../cc-queue/tealus', events: [{ t: 1, type: 'x' }] });
    expect(res.status).toBe(400);
    expect(fs.existsSync(escaped)).toBe(false);
  });
  test('★ 台帳に無い (切れた) session でも、形が正しければ受け取る (stop() の記録を落とさない、#432)', async () => {
    const sid = '6f1c0f7e-2a51-4a8e-9a53-0f5c2b7d9e11';
    const res = await request(app).post('/voice-chat/log').set(auth('u-user'))
      .send({ session_id: sid, events: [{ t: 1, type: 'x' }] });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(tmpRoot, 'ws', '_voice-chat-logs', `${sid}.jsonl`))).toBe(true);
  });
});
