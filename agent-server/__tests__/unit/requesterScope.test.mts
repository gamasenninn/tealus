/**
 * #564 AI が読める部屋を「頼んだ人が入っている部屋」に絞る (agent-server 側)。
 * - 依頼した人を処理の流れに持たせる (AsyncLocalStorage)。待ち行列に積むときも失わない
 * - 依頼ごとの使い捨ての鍵 → 中継 /tealus-scoped/<鍵>/ が X-Tealus-Requester を付けて本体へ流す
 * - Light v2 / Deep codex の道具 (tealus-mcp) の接続先を、依頼があるときは中継に向ける
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { runAsRequester, currentRequester, withCurrentRequester, issueScopedToken, requesterForToken } from '../../src/lib/requesterContext.mts';
import { createScopedProxy } from '../../src/routes/scopedProxy.mts';
import { buildLightV2McpConfig } from '../../src/agents/lightV2.mts';
import * as config from '../../src/config.mts';

const U = '11111111-1111-4111-8111-111111111111';

describe('依頼した人を処理の流れに持たせる', () => {
  it('runAsRequester の中では currentRequester が返り、外では null', async () => {
    expect(currentRequester()).toBeNull();
    await runAsRequester(U, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentRequester()).toBe(U);
    });
    expect(currentRequester()).toBeNull();
  });

  it('★ withCurrentRequester で包んだ処理は、あとで別の流れから呼んでも依頼した人を持つ (待ち行列に積むとき)', async () => {
    let later: (() => string | null) | null = null;
    await runAsRequester(U, async () => { later = withCurrentRequester(() => currentRequester()); });
    expect(later!()).toBe(U);
  });

  it('依頼した人が無い (null / 空) なら何も持たない', async () => {
    await runAsRequester(null, async () => { expect(currentRequester()).toBeNull(); });
  });
});

describe('使い捨ての鍵', () => {
  it('発行した鍵から依頼した人を引ける。期限を過ぎたら引けない', () => {
    const now = 1_000_000;
    const t = issueScopedToken(U, { now, ttlMs: 1000 });
    expect(t).toMatch(/^[a-f0-9]{48}$/);
    expect(requesterForToken(t, now + 500)).toBe(U);
    expect(requesterForToken(t, now + 1001)).toBeNull();
    expect(requesterForToken('deadbeef', now)).toBeNull();
  });
});

describe('中継 /tealus-scoped/<鍵>/', () => {
  let upstream: http.Server;
  let seen: { url?: string; requester?: string; auth?: string; body?: string; method?: string }[] = [];
  let base: string;
  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, method: req.method, requester: req.headers['x-tealus-requester'] as string, auth: req.headers.authorization, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });
  afterAll(() => { upstream.close(); });
  beforeEach(() => { seen = []; });

  const appWith = () => { const a = express(); a.use('/tealus-scoped', createScopedProxy({ upstream: () => base })); return a; };

  it('★ 鍵の依頼した人を X-Tealus-Requester に付け、道と query と認証をそのまま本体へ流す', async () => {
    const t = issueScopedToken(U);
    const res = await request(appWith()).get(`/tealus-scoped/${t}/api/bot/messages?room_id=x`).set('Authorization', 'Bearer bot');
    expect(res.status).toBe(200);
    expect(seen[0]).toMatchObject({ url: '/api/bot/messages?room_id=x', requester: U, auth: 'Bearer bot', method: 'GET' });
  });

  it('本文 (JSON) もそのまま流す', async () => {
    const t = issueScopedToken(U);
    await request(appWith()).post(`/tealus-scoped/${t}/api/auth/login`).send({ login_id: 'a', password: 'b' });
    expect(JSON.parse(seen[0].body!)).toEqual({ login_id: 'a', password: 'b' });
  });

  it('★ 呼び出し側が自分で付けた X-Tealus-Requester は捨て、鍵の人に置き換える', async () => {
    const t = issueScopedToken(U);
    await request(appWith()).get(`/tealus-scoped/${t}/api/bot/rooms`).set('X-Tealus-Requester', '22222222-2222-4222-8222-222222222222');
    expect(seen[0].requester).toBe(U);
  });

  it('知らない鍵・期限切れの鍵は 403 で、本体へ流さない', async () => {
    const res = await request(appWith()).get('/tealus-scoped/0000/api/bot/rooms');
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });
});

describe('道具 (tealus-mcp) の接続先', () => {
  // ★ テストの環境には bot の資格が無いので、ここだけ設定して読み込み直す (無いと tealus の道具が組まれず空振りする)
  type Mods = { build: typeof buildLightV2McpConfig; rc: typeof import('../../src/lib/requesterContext.mts'); cfg: typeof config };
  const load = (): Mods => {
    process.env.TEALUS_BOT_ID = 'BOT_TEST';
    process.env.TEALUS_BOT_PASS = 'pass';
    let m!: Mods;
    jest.isolateModules(() => {
      m = {
        build: require('../../src/agents/lightV2.mts').buildLightV2McpConfig,
        rc: require('../../src/lib/requesterContext.mts'),
        cfg: require('../../src/config.mts'),
      };
    });
    return m;
  };
  afterAll(() => { delete process.env.TEALUS_BOT_ID; delete process.env.TEALUS_BOT_PASS; });

  it('依頼した人が無ければ、今までどおり本体へ直接', () => {
    const { build, cfg } = load();
    const mcp = build(undefined) as Record<string, { env?: Record<string, string> }>;
    expect(mcp.tealus).toBeDefined();
    expect(mcp.tealus.env!.TEALUS_API_URL).toBe(cfg.TEALUS_API_URL);
  });

  it('★ 依頼した人がいれば、中継 (127.0.0.1 の /tealus-scoped/<鍵>) へ向ける', async () => {
    const { build, rc, cfg } = load();
    await rc.runAsRequester(U, async () => {
      const mcp = build(undefined) as Record<string, { env?: Record<string, string> }>;
      expect(mcp.tealus).toBeDefined();
      const url = mcp.tealus.env!.TEALUS_API_URL;
      expect(url.startsWith(`http://127.0.0.1:${cfg.PORT}/tealus-scoped/`)).toBe(true);
      expect(url.split('/').pop()).toMatch(/^[a-f0-9]{48}$/);
      expect(rc.requesterForToken(url.split('/').pop()!)).toBe(U);
    });
  });
});

describe('中継は外からの要求を受けない (#564)', () => {
  const appWith = () => { const a = express(); a.use('/tealus-scoped', createScopedProxy({ upstream: () => 'http://127.0.0.1:9' })); return a; };
  it.each(['x-forwarded-for', 'cf-ray'])('★ %s が付いた要求 (Cloudflare / nginx / 本体経由で外から来たもの) は 403', async (h) => {
    const t = issueScopedToken(U);
    const res = await request(appWith()).get(`/tealus-scoped/${t}/api/bot/rooms`).set(h, '203.0.113.5');
    expect(res.status).toBe(403);
  });
});
