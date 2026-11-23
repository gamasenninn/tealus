/**
 * #650 (docs/14 §6、2026-11-23) CC ブリッジの受け付けを本体へ移したときの agent-server 側
 *
 * ★ CC_INTAKE=server なら agent-server は受け箱に書かない (新規・編集とも)。取りに来る口は 410 で断る
 * ★ CC_INTAKE 未設定でも、受け箱の持ち主の札を本体が持っていれば書かない (書くたびに見る。2 つが同時に書くと切り詰めで行が消える)
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));
jest.mock('../../src/webhook/dispatcher.mts', () => ({ dispatch: jest.fn(async () => {}) }));
jest.mock('../../src/lib/botApi.mts', () => ({
  getRooms: jest.fn(async () => ({ rooms: [] })),
  pushStatus: jest.fn(async () => ({})),
}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { logger } from '../../src/lib/logger.mts';
import { handleWebhook } from '../../src/webhook/handler.mts';
import { router as ccQueueRoutes } from '../../src/routes/ccQueue.mts';
import { WRITER_FILE, claimWriter, releaseWriter, readWriterTag } from '../../src/webhook/ccWriter.mts';
import type { WebhookPayload } from '../../src/types.mts';

const room = { id: 'r1', name: '業務メモ' };
const sender = { id: 'u1', display_name: '甲野太郎', role: 'user' };

const created = (content: string): WebhookPayload => ({
  event: 'message.created', message: { id: 'm1', content, type: 'text', sender, created_at: '2026-11-23T00:00:00Z' }, room,
} as unknown as WebhookPayload);
const updated = (content: string, previous_content: string): WebhookPayload => ({
  event: 'message.updated',
  message: { id: 'm2', content, previous_content, type: 'text', sender, edited_by: sender, created_at: '2026-11-23T00:00:00Z' }, room,
} as unknown as WebhookPayload);

let testDir: string;
const queued = () => fs.readdirSync(testDir).filter((f) => f.endsWith('.jsonl'));

beforeEach(() => {
  jest.clearAllMocks();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-intake-server-'));
  process.env.CC_QUEUE_DIR = testDir;
});
afterEach(() => {
  delete process.env.CC_INTAKE;
  delete process.env.CC_QUEUE_DIR;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('CC_INTAKE=server', () => {
  test('★★ 新しい投稿も、編集で足した宛先も、受け箱に書かない', async () => {
    process.env.CC_INTAKE = 'server';
    await handleWebhook(created('@cc-tealus 見て'));
    await handleWebhook(updated('@cc-organon 追記', '追記'));
    expect(queued()).toEqual([]);
    expect(fs.existsSync(path.join(testDir, WRITER_FILE))).toBe(false);   // 札も取らない
  });

  test('★ 対照: 未設定なら今までどおり書き、札を取る', async () => {
    await handleWebhook(created('@cc-tealus 見て'));
    expect(queued()).toEqual(['tealus.jsonl']);
    expect(readWriterTag(testDir)?.process).toBe('agent-server');
  });

  test('★★ 取りに来る口 (/pending・/stream) は 410 で断る (つながっても便が来ない状態を作らない)', async () => {
    process.env.CC_INTAKE = 'server';
    const app = express();
    app.use('/cc-queue', ccQueueRoutes);
    expect((await request(app).get('/cc-queue/pending?project=tealus')).status).toBe(410);
    expect((await request(app).get('/cc-queue/stream?project=tealus')).status).toBe(410);
  });
});

describe('★ 受け箱の持ち主の札 (CC_INTAKE 未設定でも見る)', () => {
  test('★★ 同じ機械で生きている本体が札を持っていれば書かず、便の id を error に残す', async () => {
    fs.writeFileSync(path.join(testDir, WRITER_FILE), JSON.stringify({ process: 'server', host: os.hostname(), pid: process.pid, started_at: 'x' }));
    await handleWebhook(created('@cc-tealus 見て'));
    expect(queued()).toEqual([]);
    const err = (logger.error as jest.Mock).mock.calls.map((c) => String(c[0])).find((s) => s.includes('受け箱の持ち主'));
    expect(err).toContain('id=m1');
  });

  test('本体の札でも、そのプロセスが死んでいれば取って書く', async () => {
    fs.writeFileSync(path.join(testDir, WRITER_FILE), JSON.stringify({ process: 'server', host: os.hostname(), pid: 2 ** 22 + 4321, started_at: 'x' }));
    await handleWebhook(created('@cc-tealus 見て'));
    expect(queued()).toEqual(['tealus.jsonl']);
  });

  test('releaseWriter は自分の役の札だけ外す (本体の札は触らない)', () => {
    expect(claimWriter(testDir)).toEqual({ ok: true });
    releaseWriter(testDir);
    expect(fs.existsSync(path.join(testDir, WRITER_FILE))).toBe(false);
    // ★ #650 の監査 1: 前の自分 (別の PID) が強制終了で残した札も起動時に外せる (PID は見ない)
    fs.writeFileSync(path.join(testDir, WRITER_FILE), JSON.stringify({ process: 'agent-server', host: os.hostname(), pid: 99999, started_at: 'x' }));
    releaseWriter(testDir);
    expect(fs.existsSync(path.join(testDir, WRITER_FILE))).toBe(false);
    fs.writeFileSync(path.join(testDir, WRITER_FILE), JSON.stringify({ process: 'server', host: os.hostname(), pid: process.pid, started_at: 'x' }));
    releaseWriter(testDir);
    expect(readWriterTag(testDir)?.process).toBe('server');
  });
});
