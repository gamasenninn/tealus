/**
 * 本体が署名した便を、agent-server の本物の口 (app.mts の /webhook/tealus) が受け取れること (2026-10-23 改善ループ 11 回目)
 *
 * ★ 署名は両側で別々に計算している: 本体は「送る文字列そのもの」に署名し (server/src/services/webhook.mts の
 *   generateSignature)、agent-server は express.json で読んだ後に JSON.stringify し直して照合する (webhook/routes.mts)。
 *   両方の unit は自分の計算と自分を突き合わせるだけで、またいで同じ文字列になるかを誰も見ていなかった。
 *   どちらかの本文の作り方・parser の設定が変わると全便 401 → AI が一切起動しないのに、unit は緑のまま。
 * ★★ 本体の generateSignature は pool を読むので import しない (crossPackageImportGuard)。
 *   同じ手順 (送る文字列に HMAC-SHA256、`sha256=<hex>`) をここに書く。手順が変わったらこのテストも変える
 */
import request from 'supertest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-sig-app-'));
process.env.AGENT_CONFIG_DIR = tmpRoot;
process.env.AGENT_MCP_CONFIG_PATH = path.join(tmpRoot, 'mcp_config.json');
process.env.AGENT_WORKSPACE_ROOT = path.join(tmpRoot, 'ws');
process.env.CC_QUEUE_DIR = path.join(tmpRoot, 'cc-queue');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.WEBHOOK_SECRET = 'whsec-test-0123';
afterAll(() => {
  delete process.env.WEBHOOK_SECRET;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
const handled: unknown[] = [];
jest.mock('../../src/webhook/handler.mts', () => ({
  handleWebhook: async (body: unknown) => { handled.push(body); },
}));

const { app } = require('../../src/app.mts') as { app: import('express').Express };

/** 本体 (server/src/services/webhook.mts) と同じ組み立て: JSON.stringify した文字列を送り、その文字列に署名する */
function signLikeServer(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: `sha256=${crypto.createHmac('sha256', 'whsec-test-0123').update(body).digest('hex')}` };
}

// 本番に近い便: 日本語・改行・絵文字・null・入れ子・数値
const PAYLOAD = {
  event: 'message.created',
  timestamp: '2026-10-23T02:00:00.000Z',
  message: { id: 'm1', content: '@アシスタント 明日の予定は？\n「無線」も確認 🙏', type: 'text', reply_to: null,
    sender: { id: 'u1', display_name: '小野', role: 'admin' } },
  room: { id: 'r1', name: '業務メモ', type: 'group', member_count: 12 },
};

beforeEach(() => { handled.length = 0; });
const settle = () => new Promise((r) => setImmediate(r));

test('本体と同じ手順で署名した便は 200 で受け取り、handler に渡る', async () => {
  const { body, signature } = signLikeServer(PAYLOAD);
  const res = await request(app).post('/webhook/tealus')
    .set('Content-Type', 'application/json').set('X-Tealus-Signature', signature).send(body);
  expect(res.status).toBe(200);
  await settle();
  expect(handled).toEqual([PAYLOAD]);
});

test('署名が合わない便は 401 で、handler に渡らない', async () => {
  const { body } = signLikeServer(PAYLOAD);
  const res = await request(app).post('/webhook/tealus')
    .set('Content-Type', 'application/json').set('X-Tealus-Signature', 'sha256=' + '0'.repeat(64)).send(body);
  expect(res.status).toBe(401);
  await settle();
  expect(handled).toEqual([]);
});

test('署名の無い便は 401', async () => {
  const res = await request(app).post('/webhook/tealus').set('Content-Type', 'application/json').send(JSON.stringify(PAYLOAD));
  expect(res.status).toBe(401);
});
