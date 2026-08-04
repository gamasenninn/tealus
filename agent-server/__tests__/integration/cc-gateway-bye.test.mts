/**
 * 統合テスト: 中継 (本体サーバ) の再起動予告 — POST /cc-queue/gateway-bye (#368)
 *
 * ★ なぜこの口が要るか:
 *   別マシンの CC セッションは `/agent-api/cc-queue/stream` に繋いでおり、その中継を
 *   握っているのは**本体サーバのプロセス**。本体が落ちると agent-server が無傷でも
 *   ブリッジが切れる。しかし `__bye` を出せるのは agent-server (購読者を知っている側) だけ。
 *   → 本体から一段渡して配らせる。
 *
 * ★ 認可はなぜ共有 JWT か (送信元アドレスでは守れない):
 *   本体サーバの `/agent-api` proxy は外部からのリクエストを `localhost:4000` へ中継する。
 *   つまり `https://<host>/agent-api/cc-queue/gateway-bye` が **loopback 由来として
 *   agent-server に届く**ので、「loopback からのみ許可」は成立しない。
 *   agent-server の他の口と同じく共有 JWT で守る。
 *
 * Test isolation: 本番 ~/.tealus/cc-queue を触らないよう CC_QUEUE_DIR を tmpDir に向ける。
 * DB には一切触れない (agent-server は DB を持たない)。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import jwt from 'jsonwebtoken';
import express, { type Express } from 'express';
import request from 'supertest';

// **重要**: require より先に env を確定させる (module 読込時に const 化される値があるため)
const tmpQueueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gateway-bye-test-'));
process.env.CC_QUEUE_DIR = tmpQueueDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const JWT_SECRET = process.env.JWT_SECRET;

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

jest.mock('../../src/config.mts', () => ({
  TEALUS_API_URL: 'http://tealus.test',
}));

const { authenticate } = require('../../src/middleware/auth');
const { router: ccQueueRoutes } = require('../../src/routes/ccQueue');
const { addSubscriber, removeSubscriber } = require('../../src/webhook/ccSubscribers');

const token = jwt.sign({ id: 'u1', login_id: 'CLAUDE' }, JWT_SECRET, { expiresIn: '1h' });

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/cc-queue', authenticate, ccQueueRoutes);
  return app;
}

/** 書かれた行を貯めるだけの購読者 */
const created: Array<{ project: string; allowedRooms: Set<string>; sink: { write: (c: string) => boolean } }> = [];
function makeSub(project: string) {
  const written: string[] = [];
  const s = {
    project,
    allowedRooms: new Set<string>(['r1']),
    sink: { write: (c: string) => { written.push(c); return true; } },
  };
  created.push(s);
  addSubscriber(s);
  return { s, written, payloads: () => written.map((l) => JSON.parse(l.trim())) };
}

afterEach(() => {
  for (const s of created.splice(0)) removeSubscriber(s);
});

afterAll(() => {
  delete process.env.CC_QUEUE_DIR;
  fs.rmSync(tmpQueueDir, { recursive: true, force: true });
});

describe('POST /cc-queue/gateway-bye — 認可', () => {
  it('★ トークン無しは 401。購読者には何も届かない', async () => {
    const sub = makeSub('tealus');
    const res = await request(makeApp()).post('/cc-queue/gateway-bye').send({ expect_back_ms: 30000 });

    expect(res.status).toBe(401);
    expect(sub.written).toHaveLength(0);
  });

  it('★ 署名が違うトークンは 401', async () => {
    const sub = makeSub('tealus');
    const bad = jwt.sign({ id: 'u1' }, 'wrong-secret', { expiresIn: '1h' });
    const res = await request(makeApp())
      .post('/cc-queue/gateway-bye')
      .set('Authorization', `Bearer ${bad}`)
      .send({ expect_back_ms: 30000 });

    expect(res.status).toBe(401);
    expect(sub.written).toHaveLength(0);
  });
});

describe('POST /cc-queue/gateway-bye — 予告の配信', () => {
  it('★ 全 project の購読者に reason=gateway_restart が届く', async () => {
    const t = makeSub('tealus');
    const o = makeSub('organon');

    const res = await request(makeApp())
      .post('/cc-queue/gateway-bye')
      .set('Authorization', `Bearer ${token}`)
      .send({ expect_back_ms: 30000 });

    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(2);
    for (const s of [t, o]) {
      expect(s.payloads()).toHaveLength(1);
      expect(s.payloads()[0]).toEqual({ __bye: { reason: 'gateway_restart', expect_back_ms: 30000 } });
    }
  });

  it('expect_back_ms はボディの値がそのまま乗る (値を知るのは停止する側)', async () => {
    const sub = makeSub('tealus');
    await request(makeApp())
      .post('/cc-queue/gateway-bye')
      .set('Authorization', `Bearer ${token}`)
      .send({ expect_back_ms: 12345 });

    expect(sub.payloads()[0].__bye.expect_back_ms).toBe(12345);
  });

  it('★ 壊れた値・未指定は既定 (30000) に落ちる。永久に黙り込ませない', async () => {
    for (const body of [{}, { expect_back_ms: -5 }, { expect_back_ms: 'soon' }, { expect_back_ms: null }]) {
      const sub = makeSub('tealus');
      await request(makeApp())
        .post('/cc-queue/gateway-bye')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(sub.payloads()[0].__bye.expect_back_ms).toBe(30000);
      for (const s of created.splice(0)) removeSubscriber(s);
    }
  });

  it('購読者ゼロでも 200 を返す (停止処理を止めない)', async () => {
    const res = await request(makeApp())
      .post('/cc-queue/gateway-bye')
      .set('Authorization', `Bearer ${token}`)
      .send({ expect_back_ms: 30000 });

    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(0);
  });

  it('★ 予告に room の情報を含めない (制御メッセージは認可の対象外なので)', async () => {
    const sub = makeSub('tealus');
    await request(makeApp())
      .post('/cc-queue/gateway-bye')
      .set('Authorization', `Bearer ${token}`)
      .send({ expect_back_ms: 30000, room_id: 'r1', content: '見えてはいけない' });

    const line = sub.written[0];
    expect(line).not.toContain('room_id');
    expect(line).not.toContain('見えてはいけない');
    expect(Object.keys(sub.payloads()[0])).toEqual(['__bye']);
  });
});
