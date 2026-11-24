/**
 * CC ブリッジの取りに来る口を本体で答える (#650、docs/14 §5.3、2026-11-23)
 *
 * ★ agent-server の __tests__/integration/cc-queue-stream.test.mts・cc-projects.test.mts から写した。違い:
 *   - 部屋のメンバー判定は DB で直接引く (agent-server は呼び主の鍵で本体の /api/rooms を引いていた)
 *   - URL は /agent-api/... のまま。CC_INTAKE=server でなければ素通りして中継 (agent-server) に落ちる
 * ★ ストリームは supertest では扱いにくいので、実サーバを立てて生の http で見る
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { appendCcEvent, _resetLineCounts } from '../../src/services/cc/ccQueue.mts';
import { subscriberCount } from '../../src/services/cc/ccSubscribers.mts';
import { _resetReadCache } from '../../src/routes/ccQueue.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const ORIG_DIR = process.env.CC_QUEUE_DIR;
let dir: string;
let me: TestUser, stranger: TestUser;
let roomA: string, roomB: string, otherRoom: string;
let server: http.Server;
let port: number;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EV = (id: string, roomId: string) => ({ id, room_id: roomId, room_name: 'r', sender: { id: 's' }, content: `msg ${id}`, type: 'text' });
const put = (id: string, roomId: string) => appendCcEvent('tealus', EV(id, roomId), dir);

async function makeRoom(owner: TestUser, name: string): Promise<string> {
  return (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`).send({ name, member_ids: [] })).body.room.id as string;
}

interface StreamClient {
  lines: string[];
  events: () => Array<Record<string, unknown>>;
  status: number;
  headers: http.IncomingHttpHeaders;
  ended: () => boolean;
  abort: () => void;
}

function openStream(query: string, bearer: string | null = me.token): Promise<StreamClient> {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path: `/agent-api/cc-queue/stream?${query}`, headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }, (res) => {
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
      res.on('error', () => { /* abort */ });
      resolve({
        lines,
        events: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((o) => !o.__hb && !o.__bye),
        status: res.statusCode ?? 0,
        headers: res.headers,
        ended: () => closed,
        abort: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

beforeAll(async () => {
  await setupTestDb();
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeTestDb();
  process.env.CC_QUEUE_DIR = ORIG_DIR;
  delete process.env.CC_STREAM_HEARTBEAT_MS;
  delete process.env.CC_STREAM_MAX_AGE_MS;
});
beforeEach(async () => {
  await cleanTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stream-'));
  process.env.CC_QUEUE_DIR = dir;
  process.env.CC_INTAKE = 'server';
  process.env.CC_STREAM_HEARTBEAT_MS = '80';
  process.env.CC_STREAM_MAX_AGE_MS = '60000';
  _resetLineCounts();
  _resetReadCache();
  me = await createTestUser({ login_id: 'CLAUDE1', display_name: 'Claude' });
  stranger = await createTestUser({ login_id: 'EMP009', display_name: '他人' });
  roomA = await makeRoom(me, 'A');
  roomB = await makeRoom(me, 'B');
  otherRoom = await makeRoom(stranger, '入っていない部屋');
});
afterEach(() => {
  delete process.env.CC_INTAKE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const pending = (q: string, token: string | null = me.token) => {
  const r = request(app).get(`/agent-api/cc-queue/pending?${q}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

describe('認証と認可', () => {
  it('トークン無しは 401', async () => {
    expect((await pending('project=tealus', null)).status).toBe(401);
  });
  it('★ 無効化された利用者は 401 (authenticate が is_active を見る)', async () => {
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [me.user.id]);
    expect((await pending('project=tealus')).status).toBe(401);
  });
  it('project 未指定・形が違うものは 400 (★ ../ を通さない、#459)', async () => {
    expect((await pending('')).status).toBe(400);
    expect((await pending('project=..%2Fetc')).status).toBe(400);
  });
});

describe('GET /pending', () => {
  it('受け箱がまだ無くても 200 / count=0 (疎通確認に使える)', async () => {
    const res = await pending('project=tealus');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
  it('★ メンバーでない部屋の便は数えない', async () => {
    put('m1', roomA); put('m2', otherRoom); put('m3', roomB);
    expect((await pending('project=tealus')).body.count).toBe(2);
  });
  it('★ サーバの設定値 (max_age_ms / heartbeat_ms) を返す (#361)', async () => {
    const res = await pending('project=tealus');
    expect(res.body.max_age_ms).toBe(60000);
    expect(res.body.heartbeat_ms).toBe(80);
  });
  it('since を渡すとそれより後だけ数える。★ events=1 なら行そのものも返す (docs/12 §13.3)', async () => {
    put('m1', roomA); put('m2', roomA); put('m3', otherRoom); put('m4', roomB);
    const res = await pending('project=tealus&since=m1&events=1');
    expect(res.body.count).toBe(2);
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(['m2', 'm4']);
    expect((await pending('project=tealus&since=m1')).body.events).toBeUndefined();
  });
  it('★ 書き足したら読み直す (前の読み取りを使い回さない)', async () => {
    put('m1', roomA);
    expect((await pending('project=tealus')).body.count).toBe(1);
    put('m2', roomA);
    expect((await pending('project=tealus')).body.count).toBe(2);
  });
});

describe('GET /stream', () => {
  it('NDJSON のヘッダで開き、★ since 無しなら過去分は流さない (tail -n 0 と同じ)', async () => {
    put('old', roomA);
    const s = await openStream('project=tealus');
    expect(s.status).toBe(200);
    expect(String(s.headers['content-type'])).toContain('application/x-ndjson');
    await sleep(150);
    expect(s.events()).toHaveLength(0);
    s.abort();
  });
  it('★ since を渡すと切断中の便を拾える。backlog もメンバーの部屋だけ', async () => {
    put('m1', roomA); put('m2', roomA); put('m3', otherRoom); put('m4', roomB);
    const s = await openStream('project=tealus&since=m1');
    await sleep(100);
    expect(s.events().map((e) => e.id)).toEqual(['m2', 'm4']);
    s.abort();
  });
  it('★ since が見つからない (切り詰め済み) なら残っている全件', async () => {
    put('m1', roomA); put('m2', roomA);
    const s = await openStream('project=tealus&since=gone');
    await sleep(100);
    expect(s.events().map((e) => e.id)).toEqual(['m1', 'm2']);
    s.abort();
  });
  it('★ 接続中に積まれた便が届く。メンバーでない部屋の便では起こされない', async () => {
    const s = await openStream('project=tealus');
    await sleep(50);
    put('live1', otherRoom);
    put('live2', roomA);
    await sleep(100);
    expect(s.events().map((e) => e.id)).toEqual(['live2']);
    s.abort();
  });
  it('★ heartbeat が流れ、切断したら購読が外れる', async () => {
    const s = await openStream('project=tealus');
    await sleep(250);
    expect(s.lines.filter((l) => l === '{"__hb":1}').length).toBeGreaterThanOrEqual(2);
    expect(subscriberCount('tealus')).toBe(1);
    s.abort();
    await sleep(100);
    expect(subscriberCount('tealus')).toBe(0);
  });
  it('★ 準備 (鍵・部屋・受け箱の読み) の途中で切れた接続は購読者に残さない (55 分残って「並んだまま」を誤って鳴らしていた、改善ループ 106)', async () => {
    for (let i = 0; i < 5; i++) {
      // 送った直後に切る = 本体が鍵や部屋を DB で引いている間に close が来る
      const r = http.get({ port, path: '/agent-api/cc-queue/stream?project=tealus', headers: { Authorization: `Bearer ${me.token}` } });
      r.on('error', () => { /* 切った */ });
      r.on('socket', (sock) => sock.on('connect', () => setImmediate(() => r.destroy())));
    }
    await sleep(300);
    expect(subscriberCount('tealus')).toBe(0);
  });
  it('★ 最大寿命で閉じる前に理由 (__bye max_age) を伝える (#366)', async () => {
    process.env.CC_STREAM_MAX_AGE_MS = '300';
    const s = await openStream('project=tealus');
    await sleep(600);
    expect(s.ended()).toBe(true);
    const bye = s.lines.map((l) => JSON.parse(l) as { __bye?: { reason: string } }).find((o) => o.__bye);
    expect(bye?.__bye?.reason).toBe('max_age');
    expect(subscriberCount('tealus')).toBe(0);
  });
});

describe('GET /agent-api/agent/cc-projects', () => {
  it('受け箱の班の一覧 (★ CC_QUEUE_DIR を見る)', async () => {
    put('m1', roomA);
    appendCcEvent('organon', EV('m2', roomA), dir);
    fs.writeFileSync(path.join(dir, 'Bad_Name.jsonl'), '');
    const res = await request(app).get('/agent-api/agent/cc-projects').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(['organon', 'tealus']);
  });
  it('★ ゲストには見せない (#494)', async () => {
    await getTestPool().query("UPDATE users SET role = 'guest' WHERE id = $1", [me.user.id]);
    expect((await request(app).get('/agent-api/agent/cc-projects').set('Authorization', `Bearer ${me.token}`)).status).toBe(403);
  });
});

describe('★★ CC_INTAKE=server でなければ本体は答えない (中継へ素通り)', () => {
  it('pending の応答が本体のものではない (agent-server に落ちる)', async () => {
    delete process.env.CC_INTAKE;
    // ★ 中継の先 (agent-server) が無ければ 5xx、この機械のように動いていればテストの鍵を断って 401。どちらでも本体の 200 ではない
    const res = await pending('project=tealus');
    expect(res.status).not.toBe(200);
    expect(res.body.max_age_ms).toBeUndefined();
  });
});
