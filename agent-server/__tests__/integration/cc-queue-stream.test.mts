/**
 * 統合テスト: cc-queue HTTP ストリーム (#214)
 *
 * file beacon (`~/.tealus/cc-queue/{project}.jsonl` + `tail -n 0 -F`) の**復路だけ**が
 * 同一ホストを要求していた。それを HTTP で受け取れるようにする経路のテスト。
 *
 * ★ 認可: agent-server の `authenticate` は署名検証のみで DB を見ない (疎結合設計)。
 *   そこで接続時に**呼び出し元のトークンで**本体の `GET /api/rooms` を引き、
 *   その参加ルームのイベントだけを配る。beacon を書く bot (agent-server) と
 *   消費して返信する bot (CC セッション) は別 principal で参加ルームが違うため、
 *   これをしないと「返信できない (bot API が 403) イベントで起こされる」。
 *
 * Test isolation: CC_QUEUE_DIR を tmpDir に向け、本番 ~/.tealus/cc-queue を触らない。
 * fetch は差し替えるのでネットワークにも出ない。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import express, { type Express } from 'express';

// **重要**: require より先に env を確定させる (module 読込時に const 化される値があるため)
const tmpQueueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stream-test-'));
process.env.CC_QUEUE_DIR = tmpQueueDir;
process.env.CC_STREAM_HEARTBEAT_MS = '80';   // 実時間で検証するため短く
process.env.CC_STREAM_MAX_AGE_MS = '400';    // 同上 (本番既定は 55 分)
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
const { appendCcEvent } = require('../../src/webhook/ccQueue');
const { subscriberCount } = require('../../src/webhook/ccSubscribers');

const ROOM_A = 'room-a';
const ROOM_B = 'room-b';
const OTHER = 'room-not-member';   // 呼び出し元が member でないルーム

const token = jwt.sign({ id: 'u1', login_id: 'CLAUDE' }, JWT_SECRET, { expiresIn: '1h' });

/** 本体 /api/rooms の差し替え。既定は ROOM_A / ROOM_B の member */
let roomsResponse: { status: number; rooms?: Array<{ id: string }> };
let fetchCalls: Array<{ url: string; headers: Record<string, string> }>;

beforeEach(() => {
  roomsResponse = { status: 200, rooms: [{ id: ROOM_A }, { id: ROOM_B }] };
  fetchCalls = [];
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    fetchCalls.push({ url: String(url), headers: init?.headers || {} });
    return {
      ok: roomsResponse.status >= 200 && roomsResponse.status < 300,
      status: roomsResponse.status,
      json: async () => ({ rooms: roomsResponse.rooms || [] }),
    };
  });
  // queue file を毎回まっさらに
  fs.rmSync(path.join(tmpQueueDir, 'tealus.jsonl'), { force: true });
});

afterAll(() => {
  delete process.env.CC_QUEUE_DIR;
  delete process.env.CC_STREAM_HEARTBEAT_MS;
  delete process.env.CC_STREAM_MAX_AGE_MS;
  fs.rmSync(tmpQueueDir, { recursive: true, force: true });
});

// --- test harness -----------------------------------------------------------

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/cc-queue', authenticate, ccQueueRoutes);
  return app;
}

/** 実サーバを立てる (ストリームは supertest では扱いにくいため生 http で検証する) */
async function listen(app: Express): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return { port, close: () => new Promise<void>((r) => { server.close(() => r()); }) };
}

interface StreamClient {
  lines: string[];
  events: () => Array<Record<string, unknown>>;   // heartbeat を除いたもの
  status: number;
  headers: http.IncomingHttpHeaders;
  ended: () => boolean;                           // サーバ側から閉じられたか (#360)
  abort: () => void;
}

/** NDJSON ストリームを開き、届いた行を貯める */
function openStream(port: number, query: string, bearer = token): Promise<StreamClient> {
  return new Promise((resolve, reject) => {
    const req = http.get({
      port, path: `/cc-queue/stream?${query}`,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    }, (res) => {
      const lines: string[] = [];
      let buf = '';
      let closed = false;
      res.setEncoding('utf8');
      res.on('end', () => { closed = true; });
      res.on('data', (chunk: string) => {
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const p of parts) if (p !== '') lines.push(p);
      });
      res.on('error', () => { /* abort 時に来る */ });
      resolve({
        lines,
        events: () => lines.map((l) => JSON.parse(l)).filter((o) => !o.__hb),
        status: res.statusCode ?? 0,
        headers: res.headers,
        ended: () => closed,
        abort: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EV = (id: string, roomId: string) => ({ id, room_id: roomId, room_name: 'r', sender: { id: 's' }, content: `msg ${id}`, type: 'text' });

// --- 認証 / 認可 -------------------------------------------------------------

describe('cc-queue — 認証と認可', () => {
  test('トークン無しは 401 (agent-server の authenticate)', async () => {
    const srv = await listen(makeApp());
    const res = await fetchStatus(srv.port, '/cc-queue/pending?project=tealus', null);
    expect(res.status).toBe(401);
    await srv.close();
  });

  test('★ 本体 /api/rooms が 401 を返したらこちらも 401 (無効化ユーザーの穴を塞ぐ)', async () => {
    roomsResponse = { status: 401 };
    const srv = await listen(makeApp());
    const res = await fetchStatus(srv.port, '/cc-queue/pending?project=tealus', token);
    expect(res.status).toBe(401);
    await srv.close();
  });

  test('★ 参加ルームは呼び出し元のトークンで引く (agent-server の bot ではない)', async () => {
    const srv = await listen(makeApp());
    await fetchStatus(srv.port, '/cc-queue/pending?project=tealus', token);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('http://tealus.test/api/rooms');
    expect(fetchCalls[0].headers.Authorization).toBe(`Bearer ${token}`);
    await srv.close();
  });

  test('project 未指定は 400', async () => {
    const srv = await listen(makeApp());
    const res = await fetchStatus(srv.port, '/cc-queue/pending', token);
    expect(res.status).toBe(400);
    await srv.close();
  });
});

// --- pending (arm 前の疎通確認) ---------------------------------------------

describe('cc-queue — GET /pending', () => {
  test('queue file がまだ無くても 200 / count=0 (疎通確認に使えること)', async () => {
    const srv = await listen(makeApp());
    const res = await fetchJson(srv.port, '/cc-queue/pending?project=tealus', token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ project: 'tealus', count: 0 });
    await srv.close();
  });

  test('★ member でないルームのイベントは数えない', async () => {
    appendCcEvent('tealus', EV('m1', ROOM_A));
    appendCcEvent('tealus', EV('m2', OTHER));
    appendCcEvent('tealus', EV('m3', ROOM_B));

    const srv = await listen(makeApp());
    const res = await fetchJson(srv.port, '/cc-queue/pending?project=tealus', token);
    expect(res.body.count).toBe(2);
    await srv.close();
  });

  test('★ サーバの設定値 (max_age_ms / heartbeat_ms) を返す (#361)', async () => {
    // クライアントはこれを使って「今の切断は予定どおりか」を自分で判定する。
    // これが無いと値をハードコードするしかなく、サーバ側で max_age を変えた瞬間に
    // **全ての切断が「想定外」に落ちて通知の嵐になる** (2026-08-01 の 120 秒実験で実例)。
    const srv = await listen(makeApp());
    const res = await fetchJson(srv.port, '/cc-queue/pending?project=tealus', token);

    expect(res.status).toBe(200);
    expect(res.body.max_age_ms).toBe(400);      // CC_STREAM_MAX_AGE_MS
    expect(res.body.heartbeat_ms).toBe(80);     // CC_STREAM_HEARTBEAT_MS
    // 既存フィールドは不変 (古いクライアントを壊さない)
    expect(res.body).toMatchObject({ project: 'tealus', count: 0 });

    await srv.close();
  });

  test('since を渡すとそれ以降だけ数える', async () => {
    appendCcEvent('tealus', EV('m1', ROOM_A));
    appendCcEvent('tealus', EV('m2', ROOM_A));
    appendCcEvent('tealus', EV('m3', ROOM_A));

    const srv = await listen(makeApp());
    const res = await fetchJson(srv.port, '/cc-queue/pending?project=tealus&since=m1', token);
    expect(res.body.count).toBe(2);
    await srv.close();
  });
});

// --- stream ------------------------------------------------------------------

describe('cc-queue — GET /stream', () => {
  test('NDJSON のヘッダで開く', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    expect(s.status).toBe(200);
    expect(s.headers['content-type']).toContain('application/x-ndjson');
    expect(s.headers['cache-control']).toContain('no-cache');
    s.abort();
    await srv.close();
  });

  test('★ since 無しなら過去分は流さない (file モードの tail -n 0 と等価)', async () => {
    appendCcEvent('tealus', EV('old', ROOM_A));

    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(30);
    expect(s.events()).toHaveLength(0);

    appendCcEvent('tealus', EV('new', ROOM_A));
    await sleep(30);
    expect(s.events().map((e) => e.id)).toEqual(['new']);

    s.abort();
    await srv.close();
  });

  test('★ since を渡すと切断中のイベントを拾える (受信済みカーソル)', async () => {
    appendCcEvent('tealus', EV('m1', ROOM_A));
    appendCcEvent('tealus', EV('m2', ROOM_A));
    appendCcEvent('tealus', EV('m3', ROOM_A));

    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus&since=m1');
    await sleep(50);
    expect(s.events().map((e) => e.id)).toEqual(['m2', 'm3']);

    s.abort();
    await srv.close();
  });

  test('★ backlog も member のルームだけ', async () => {
    appendCcEvent('tealus', EV('m1', ROOM_A));
    appendCcEvent('tealus', EV('m2', OTHER));
    appendCcEvent('tealus', EV('m3', ROOM_B));

    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus&since=m1');
    await sleep(50);
    expect(s.events().map((e) => e.id)).toEqual(['m3']);

    s.abort();
    await srv.close();
  });

  test('★ since の id が見つからない (trim 済み) なら残っている全件を流す', async () => {
    appendCcEvent('tealus', EV('m1', ROOM_A));
    appendCcEvent('tealus', EV('m2', ROOM_A));

    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus&since=already-trimmed');
    await sleep(50);
    expect(s.events().map((e) => e.id)).toEqual(['m1', 'm2']);

    s.abort();
    await srv.close();
  });

  test('★ member でないルームのイベントでは起こされない (live)', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(30);

    appendCcEvent('tealus', EV('dm', OTHER));
    await sleep(50);

    expect(s.events()).toHaveLength(0);
    s.abort();
    await srv.close();
  });

  test('★ heartbeat が流れる = 無音でも接続が切れない、かつ event ではない', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(260);   // CC_STREAM_HEARTBEAT_MS=80 → 3 回前後

    const hb = s.lines.map((l) => JSON.parse(l)).filter((o) => o.__hb);
    expect(hb.length).toBeGreaterThanOrEqual(2);
    expect(s.events()).toHaveLength(0);   // heartbeat は event ではない

    s.abort();
    await srv.close();
  });

  test('★ 切断したら購読解除される (切断済み購読者を溜めない)', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(30);
    expect(subscriberCount('tealus')).toBe(1);

    s.abort();
    await sleep(80);
    expect(subscriberCount('tealus')).toBe(0);

    await srv.close();
  });

  test('別 project の購読者には届かない', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=organon');
    await sleep(30);

    appendCcEvent('tealus', EV('m1', ROOM_A));
    await sleep(50);

    expect(s.events()).toHaveLength(0);
    s.abort();
    await srv.close();
  });
});

// --- helpers ----------------------------------------------------------------

function fetchStatus(port: number, pathname: string, bearer: string | null): Promise<{ status: number }> {
  return fetchJson(port, pathname, bearer);
}

function fetchJson(port: number, pathname: string, bearer: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path: pathname, headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { buf += c; });
      res.on('end', () => {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(buf); } catch { /* 本文なしもある */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
  });
}

// --- 接続の最大寿命 (#360) ------------------------------------------------
//
// ★ なぜ要るか: 認可 (allowedRooms) は接続時に /api/rooms を引いた**スナップショット**で、
//   JWT の検証も入口で 1 回だけ。接続が長生きするほど権限が古くなる。実測で 2 時間 26 分
//   無切断の接続が出たため、こちらから寿命を切って**クライアントの再接続ループに
//   再ログイン + 再認可をさせる**。取りこぼしは since (受信済みカーソル) が防ぐ。

describe('cc-queue — 接続の最大寿命 (#360)', () => {
  test('★ 最大寿命を過ぎたら接続が閉じる', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');

    await sleep(200);
    expect(s.ended()).toBe(false);   // まだ寿命前

    await sleep(400);
    expect(s.ended()).toBe(true);    // CC_STREAM_MAX_AGE_MS=400 を過ぎた

    await srv.close();
  });

  test('★ 寿命で閉じたら購読も解除される (切断済み購読者を溜めない)', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(50);
    expect(subscriberCount('tealus')).toBe(1);

    await sleep(500);
    expect(subscriberCount('tealus')).toBe(0);

    s.abort();
    await srv.close();
  });

  // ★ #366: 理由を配る。クライアントに経過秒から逆算させない。
  //   別マシンでの実測で、寿命切断が SEC=3298 と記録され「想定外」として通知された。
  //   サーバ側の実測は 3300 秒ちょうどで、2 台の時計が 55 分で 2 秒ずれていた
  //   (`date +%s` は壁時計であって単調増加しない)。**理由を知っているのはサーバだけ**。
  test('★ 寿命で閉じる前に理由を伝える (#366)', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(550);

    const bye = s.lines.map((l) => JSON.parse(l)).find((o) => o.__bye);
    expect(bye).toBeDefined();
    expect(bye.__bye.reason).toBe('max_age');
    // 停止 (shutdown) と違い、サーバは動き続けている。すぐ戻る値を渡す
    expect(bye.__bye.expect_back_ms).toBeGreaterThan(0);
    expect(s.ended()).toBe(true);

    s.abort();
    await srv.close();
  });

  test('★ 理由は閉じる前に届く (end の後では受け取れない)', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(550);

    // 最終行が __bye であること = end() の直前に書けている
    const last = JSON.parse(s.lines[s.lines.length - 1]);
    expect(last.__bye).toBeDefined();

    s.abort();
    await srv.close();
  });

  test('★ 寿命で閉じたことがログに残る (黙って切れない)', async () => {
    const { logger } = require('../../src/lib/logger.mts');
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(550);

    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/最大寿命|max age/));

    s.abort();
    await srv.close();
  });

  // ★ #214 切断調査 (2026-08-13)。「__bye を送ったのに届いていない」が起きたとき、
  //   サーバ側は **書きに行ったこと** しか言えなかった。write は silent catch で、
  //   戻り値も例外も残していない。→ 「送った」と「出た」の区別が両側から付かない。
  //   Mac 側は同日 hb_age (最後に heartbeat を受けた時刻) を足した。こちらは送出側を残す。
  describe('__bye の送出結果を残す (2026-08-13 切断調査)', () => {
    test('★ 送れたかどうかがログに残る (accepted / 未送出バイト)', async () => {
      const { logger } = require('../../src/lib/logger.mts');
      const srv = await listen(makeApp());
      const s = await openStream(srv.port, 'project=tealus');
      await sleep(550);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/__bye 送出.*reason=max_age.*accepted=/));

      s.abort();
      await srv.close();
    });

    test('★ 相手が先に消えていても、送出を試みた記録が残る (黙って諦めない)', async () => {
      const { logger } = require('../../src/lib/logger.mts');
      const srv = await listen(makeApp());
      const s = await openStream(srv.port, 'project=tealus');
      await sleep(50);
      s.abort();            // ★ クライアントが先に消える
      await sleep(550);     // その後で寿命が来る

      // 送出行そのものは必ず出す。destroyed=true で「相手が居ない状態で書いた」と分かる
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/__bye 送出/));

      await srv.close();
    });

    // ★ 2026-08-14 に実運用で判明。`writableLength` を write の **後** に読んでいたため、
    //   45 件すべてが pending=59B (= いま書いた __bye 行 + chunked 枠) で固定されていた。
    //   「書く前に溜まっていたか」を測るつもりが、自分が書いた分を数えていた。
    //   このままだと「詰まっていなかった」が証拠ゼロで常に成立してしまう。
    test('★ pending_before は「書く前に溜まっていた量」— 正常な接続では 0 になる', async () => {
      const { logger } = require('../../src/lib/logger.mts');
      const srv = await listen(makeApp());
      const s = await openStream(srv.port, 'project=tealus');
      await sleep(550);

      // 相手が正常に吸っていれば、書く前のバッファは空
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/__bye 送出.*pending_before=0B/));

      s.abort();
      await srv.close();
    });

    test('★ 送出行に接続の状態を含める (destroyed — 死んだ接続に書いたかが分かる)', async () => {
      const { logger } = require('../../src/lib/logger.mts');
      const srv = await listen(makeApp());
      const s = await openStream(srv.port, 'project=tealus');
      await sleep(550);

      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/destroyed=/));

      s.abort();
      await srv.close();
    });
  });

  test('寿命が来る前のイベントは通常どおり届く', async () => {
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(30);

    appendCcEvent('tealus', EV('before-expiry', ROOM_A));
    await sleep(50);

    expect(s.events().map((e) => e.id)).toEqual(['before-expiry']);
    s.abort();
    await srv.close();
  });
});

/**
 * #359 follow-up (2026-08-20): 切断の起点を両側で突き合わせるための計器。
 *
 * Mac セッション側は `hb_age` の分布で「予告済みは位相が寄る / 想定外は一様」を示した。
 * ★ 同じ量をサーバ側でも **実測** できないと突き合わせられない (名目間隔からの計算は
 * setInterval のドリフトを含むので代用にならない)。
 */
describe('cc-queue — 切断の計器 (#359 follow-up)', () => {
  const { logger } = require('../../src/lib/logger.mts');

  function removedLines(): string[] {
    return [...(logger.info as jest.Mock).mock.calls, ...(logger.debug as jest.Mock).mock.calls]
      .map((c) => String(c[0]))
      .filter((m) => m.includes('subscriber removed'));
  }

  test('★ 切断行に hb_age と接続齢が実測で出る', async () => {
    (logger.info as jest.Mock).mockClear();
    (logger.debug as jest.Mock).mockClear();
    const srv = await listen(makeApp());
    const s = await openStream(srv.port, 'project=tealus');
    await sleep(200);   // heartbeat 80ms → 2 回以上流れている
    s.abort();
    await sleep(80);

    const line = removedLines().pop() ?? '';
    expect(line).toMatch(/hb_age=\d+s/);   // '-' ではない = 実際に書いた時刻から測っている
    expect(line).toMatch(/age=\d+s/);
    await srv.close();
  });

  test('★ 接続行と切断行が同じ id を持つ (購読者 2 本のどちらが落ちたか分かる)', async () => {
    (logger.info as jest.Mock).mockClear();
    const srv = await listen(makeApp());
    const a = await openStream(srv.port, 'project=tealus');
    const b = await openStream(srv.port, 'project=tealus');
    await sleep(30);

    const connectIds = (logger.info as jest.Mock).mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('[cc-stream] 接続:'))
      .map((m) => /id=(\w+)/.exec(m)?.[1]);
    expect(connectIds).toHaveLength(2);
    expect(new Set(connectIds).size).toBe(2);   // 2 本が別 id

    a.abort();
    await sleep(80);
    const removedId = /id=(\w+)/.exec(removedLines().pop() ?? '')?.[1];
    expect(connectIds).toContain(removedId);

    b.abort();
    await srv.close();
  });
});
