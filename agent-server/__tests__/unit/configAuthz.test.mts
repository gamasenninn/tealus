/**
 * agent-server の設定 API (/config/*) の権限 (#458、2026-09-26)
 *
 * ★ それまで: ログインしているか (JWT の署名) しか見ておらず、一般の利用者でも全ルームの設定・全体の設定を書けた。
 * ★★ 形 (利用者判断 2026-09-26): 資源の持ち主 (agent-server) が自分で判断する。
 *   事実 (役割・ルームでの役割) は **利用者自身の鍵で** 本体 (GET /api/auth/authz) に聞く。
 *   中継 (/agent-api) で確かめる案は採らない —— 4000 番に直接届けば素通りで、別サーバに分けたら中継が無くなる。
 * ★ 決め方 (本体アプリの画面の表示条件と同じ):
 *   /tts-options           ログインしていればよい (秘密を含まない選択肢)
 *   /room/:roomId/...      システム管理者 / そのルームの管理者 / DM の当人
 *   それ以外 (全体)         システム管理者だけ
 * ★ 本体に聞けないときは断る (503)。10 秒は結果を覚える (ルーム設定の画面は 1 度に 4 本呼ぶ)。
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import { classifyConfigPath, isAllowed, createConfigAuthz, type AuthzFacts } from '../../src/lib/configAuthz.mts';

const facts = (role: string, room: AuthzFacts['room'] = null): AuthzFacts => ({ user_id: 'u1', role, room });

describe('classifyConfigPath — ★ どの種類の呼び出しか', () => {
  test.each([
    ['/tts-options', { kind: 'open' }],
    ['/room/abc/settings', { kind: 'room', roomId: 'abc' }],
    ['/room/abc/light-prompt', { kind: 'room', roomId: 'abc' }],
    ['/room/abc/mcp', { kind: 'room', roomId: 'abc' }],
    ['/settings', { kind: 'global' }],
    ['/mcp', { kind: 'global' }],
    ['/system-prompt', { kind: 'global' }],
    ['/env', { kind: 'global' }],
    ['/rooms', { kind: 'global' }],
    ['/rooms/agent-1', { kind: 'global' }],
    ['/agent-room-counts', { kind: 'global' }],
  ])('%s', (p, want) => {
    expect(classifyConfigPath(p)).toEqual(want);
  });

  test('★ 知らない道は全体扱い (= 管理者だけ。★ 足した道を黙って開けない)', () => {
    expect(classifyConfigPath('/something-new')).toEqual({ kind: 'global' });
  });
});

describe('isAllowed — ★ 判断の表', () => {
  const group = (member_role: string | null) => ({ id: 'r1', type: 'group', member_role });
  const dm = (member_role: string | null) => ({ id: 'r2', type: 'direct', member_role });

  test('open はだれでも', () => {
    expect(isAllowed({ kind: 'open' }, facts('user'))).toBe(true);
  });
  test('★ 全体はシステム管理者だけ', () => {
    expect(isAllowed({ kind: 'global' }, facts('admin'))).toBe(true);
    expect(isAllowed({ kind: 'global' }, facts('user'))).toBe(false);
    expect(isAllowed({ kind: 'global' }, facts('guest'))).toBe(false);
  });
  test('★ ルーム: システム管理者 / そのルームの管理者 / DM の当人', () => {
    expect(isAllowed({ kind: 'room', roomId: 'r1' }, facts('admin', group(null)))).toBe(true);
    expect(isAllowed({ kind: 'room', roomId: 'r1' }, facts('user', group('admin')))).toBe(true);
    expect(isAllowed({ kind: 'room', roomId: 'r2' }, facts('user', dm('member')))).toBe(true);
  });
  test('★★ ルーム: 一般メンバー / 入っていない人 / 他人の DM は断る', () => {
    expect(isAllowed({ kind: 'room', roomId: 'r1' }, facts('user', group('member')))).toBe(false);
    expect(isAllowed({ kind: 'room', roomId: 'r1' }, facts('user', group(null)))).toBe(false);
    expect(isAllowed({ kind: 'room', roomId: 'r2' }, facts('user', dm(null)))).toBe(false);
  });
  test('★ 存在しないルームは管理者だけ (★ 作る前の設定を管理者が置ける)', () => {
    expect(isAllowed({ kind: 'room', roomId: 'x' }, facts('user', null))).toBe(false);
    expect(isAllowed({ kind: 'room', roomId: 'x' }, facts('admin', null))).toBe(true);
  });
});

describe('createConfigAuthz — ★ 利用者の鍵で本体に聞いて判断する', () => {
  type Res = { status: jest.Mock; json: jest.Mock };
  const mkRes = (): Res => { const r = { status: jest.fn(), json: jest.fn() } as Res; r.status.mockReturnValue(r); return r; };
  const mkReq = (p: string, token = 'tok-A') => ({ path: p, headers: { authorization: `Bearer ${token}` } });
  const serverSays = (body: unknown, status = 200) => jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

  test('★ open は本体に聞かずに通す', async () => {
    const fetchImpl = serverSays(facts('user'));
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never });
    const next = jest.fn();
    await mw(mkReq('/tts-options') as never, mkRes() as never, next);
    expect(next).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('★★ 利用者自身の鍵で、ルームを付けて聞く', async () => {
    const fetchImpl = serverSays(facts('user', { id: 'r 1', type: 'group', member_role: 'admin' }));
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never });
    const next = jest.fn();
    await mw(mkReq('/room/r 1/settings', 'user-token') as never, mkRes() as never, next);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://s/api/auth/authz?room_id=r%201');
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect(next).toHaveBeenCalled();
  });

  test('★ 許されなければ 403', async () => {
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: serverSays(facts('user')) as never });
    const res = mkRes(); const next = jest.fn();
    await mw(mkReq('/settings') as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('★★ 本体が 401 (無効化された利用者など) なら 401', async () => {
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: serverSays({ error: 'x' }, 401) as never });
    const res = mkRes(); const next = jest.fn();
    await mw(mkReq('/settings') as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('★★★ 本体に聞けないときは断る (503)', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never });
    const res = mkRes(); const next = jest.fn();
    await mw(mkReq('/settings') as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('★ 本体の 500 も断る (503)', async () => {
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: serverSays({}, 500) as never });
    const res = mkRes();
    await mw(mkReq('/settings') as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('★ 10 秒は覚える (同じ鍵・同じルーム)。過ぎたら聞き直す', async () => {
    let t = 1000;
    const fetchImpl = serverSays(facts('admin'));
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never, now: () => t });
    for (const p of ['/settings', '/mcp', '/env']) await mw(mkReq(p) as never, mkRes() as never, jest.fn());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 10_001;
    await mw(mkReq('/settings') as never, mkRes() as never, jest.fn());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('★★ 鍵が違えば覚えた結果を使わない (★ 他人の結果を流用しない)', async () => {
    const fetchImpl = serverSays(facts('admin'));
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never, now: () => 1 });
    await mw(mkReq('/settings', 'tok-A') as never, mkRes() as never, jest.fn());
    await mw(mkReq('/settings', 'tok-B') as never, mkRes() as never, jest.fn());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('★ 失敗した問い合わせは覚えない (本体が戻ったらすぐ通る)', async () => {
    let fail = true;
    const fetchImpl = jest.fn(async () => { if (fail) throw new Error('down'); return { ok: true, status: 200, json: async () => facts('admin') }; });
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never, now: () => 1 });
    await mw(mkReq('/settings') as never, mkRes() as never, jest.fn());
    fail = false;
    const next = jest.fn();
    await mw(mkReq('/settings') as never, mkRes() as never, next);
    expect(next).toHaveBeenCalled();
  });
});
