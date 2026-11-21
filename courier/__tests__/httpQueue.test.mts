/**
 * 段階 3: 相手の PC が HTTP で便を取りに来る (docs/12 §14、2026-11-21)
 * ★ /pending?events=1 で取った行の id だけを手元の写しに足す。配る輪は写しのファイルを今までどおり読む
 * ★ since が queue に無いと agent-server は残り全部を返す → 写しに既にある id は足さない
 * ★ 本文は写さない・取れないときは写しを触らない・ログインの鍵は使い回して 401 のときだけ取り直す
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { httpQueueMirror, MIRROR_MAX_LINES } from '../src/httpQueue.mts';
import { readQueue } from '../src/queue.mts';
import { loadBridges } from '../src/config.mts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const auth = { api_url: 'https://tealus.example', login_id: 'bot-db', password: 'pw' };

type Call = { url: string; method: string; auth?: string };

/** 偽の本体: queue の中身 (部屋のメンバー判定は済んだもの) を持ち、agent-server と同じ since の読み方をする */
function fakeServer(queue: () => Array<Record<string, unknown>>, opts: { failPending?: number; expireOnce?: boolean } = {}) {
  const calls: Call[] = [];
  let logins = 0;
  let expired = opts.expireOnce ?? false;
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    if (url.endsWith('/api/auth/login')) {
      logins++;
      return { status: 200, json: async () => ({ token: `t${logins}` }) };
    }
    if (opts.failPending) return { status: opts.failPending, json: async () => ({ error: 'x' }) };
    if (expired) { expired = false; return { status: 401, json: async () => ({ error: 'トークンが無効です' }) }; }
    const u = new URL(url);
    const since = u.searchParams.get('since');
    const all = queue();
    let events = all;
    if (since) {
      const at = all.findIndex((e) => e.id === since);
      events = at >= 0 ? all.slice(at + 1) : all;   // ★ 見つからなければ残り全部 (agent-server の backlogSince)
    }
    return { status: 200, json: async () => ({ project: u.searchParams.get('project'), count: events.length, events }) };
  };
  return { fetchImpl, calls, logins: () => logins };
}

const row = (n: number) => ({ id: id(n), room_id: 'r', room_name: '部屋', content: `本文 ${n}`, sender: { display_name: '人' } });

describe('httpQueueMirror', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-m-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const file = () => path.join(dir, 'db.jsonl');

  it('写しが無い (初めて) は since なしで取り、全部を写す。写すのは id だけ (本文・部屋・送り主は書かない)', async () => {
    const s = fakeServer(() => [row(1), row(2)]);
    const r = await httpQueueMirror(auth, s.fetchImpl)('db', dir);
    expect(r).toEqual({ ok: true, added: 2 });
    const pending = s.calls.find((c) => c.url.includes('/pending'))!;
    expect(pending.url).toBe('https://tealus.example/agent-api/cc-queue/pending?project=db&events=1');
    expect(fs.readFileSync(file(), 'utf8')).toBe(`{"id":"${id(1)}"}\n{"id":"${id(2)}"}\n`);
    const q = readQueue(file());
    expect(q.ok && q.ids).toEqual([id(1), id(2)]);
  });

  it('2 回目からは写しの最後の id を since にして、後ろだけを足す', async () => {
    let q = [row(1), row(2)];
    const s = fakeServer(() => q);
    const m = httpQueueMirror(auth, s.fetchImpl);
    await m('db', dir);
    q = [row(1), row(2), row(3)];
    expect(await m('db', dir)).toEqual({ ok: true, added: 1 });
    expect(s.calls.filter((c) => c.url.includes('/pending')).at(-1)!.url).toContain(`since=${id(2)}`);
    const r = readQueue(file());
    expect(r.ok && r.ids).toEqual([id(1), id(2), id(3)]);
  });

  it('★ since が queue から消えていて全部が返ってきても、写しに既にある id は足さない', async () => {
    let q = [row(1), row(2)];
    const s = fakeServer(() => q);
    const m = httpQueueMirror(auth, s.fetchImpl);
    await m('db', dir);
    q = [row(5), row(1), row(6)];   // id(2) は切り詰めで消えた。since=id(2) は見つからず全部が返る
    expect(await m('db', dir)).toEqual({ ok: true, added: 2 });
    const r = readQueue(file());
    expect(r.ok && r.ids).toEqual([id(1), id(2), id(5), id(6)]);
  });

  it('新着が無ければ写しを書き換えない', async () => {
    const s = fakeServer(() => [row(1)]);
    const m = httpQueueMirror(auth, s.fetchImpl);
    await m('db', dir);
    const before = fs.statSync(file()).mtimeMs;
    expect(await m('db', dir)).toEqual({ ok: true, added: 0 });
    expect(fs.statSync(file()).mtimeMs).toBe(before);
  });

  it('★ ログインの鍵は使い回す。401 のときだけ 1 回取り直す', async () => {
    const s = fakeServer(() => [row(1)]);
    const m = httpQueueMirror(auth, s.fetchImpl);
    await m('db', dir); await m('db', dir); await m('db', dir);
    expect(s.logins()).toBe(1);
    const s2 = fakeServer(() => [row(1)], { expireOnce: true });
    const r = await httpQueueMirror(auth, s2.fetchImpl)('db', dir);
    expect(r.ok).toBe(true);
    expect(s2.logins()).toBe(2);
  });

  it('★ 取れない (500 など) ときは写しを触らず、理由を返す', async () => {
    fs.writeFileSync(file(), `{"id":"${id(1)}"}\n`);
    const s = fakeServer(() => [row(1), row(2)], { failPending: 502 });
    const r = await httpQueueMirror(auth, s.fetchImpl)('db', dir);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(file(), 'utf8')).toBe(`{"id":"${id(1)}"}\n`);
  });

  it('つながらない (fetch が投げる) ときも投げずに理由を返す', async () => {
    const r = await httpQueueMirror(auth, async () => { throw new Error('ECONNREFUSED'); })('db', dir);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('ECONNREFUSED') });
  });

  it('id の形でない行は写さない', async () => {
    const s = fakeServer(() => [row(1), { id: 'x; rm' }, { content: 'id なし' }]);
    expect(await httpQueueMirror(auth, s.fetchImpl)('db', dir)).toEqual({ ok: true, added: 1 });
  });

  it(`写しは最後の ${MIRROR_MAX_LINES} 行に切り詰める`, async () => {
    const many = Array.from({ length: MIRROR_MAX_LINES + 5 }, (_, i) => row(i + 1));
    const s = fakeServer(() => many);
    await httpQueueMirror(auth, s.fetchImpl)('db', dir);
    const r = readQueue(file());
    expect(r.ok && r.ids.length).toBe(MIRROR_MAX_LINES);
    expect(r.ok && r.ids.at(-1)).toBe(id(MIRROR_MAX_LINES + 5));
  });
});

describe('bridges.json の queue: "http"', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-c-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('queue を読む。書かなければ file。知らない値の行は使わない', () => {
    fs.writeFileSync(path.join(dir, 'bridges.json'), JSON.stringify([
      { project: 'dbbackup', adapter: 'herdr', agent: 'dbbackup', queue: 'http', enabled: true },
      { project: 'lp', adapter: 'herdr', agent: 'lp', enabled: true },
      { project: 'bad', adapter: 'herdr', agent: 'bad', queue: 'ftp', enabled: true },
    ]));
    const r = loadBridges(dir);
    expect(r.ok && r.bridges.map((b) => [b.project, b.queue])).toEqual([['dbbackup', 'http'], ['lp', 'file']]);
    expect(r.ok && r.skipped).toHaveLength(1);
  });
});
