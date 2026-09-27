/**
 * #459 agent-server の「署名だけ」の入口 —— /config と同じ判断の表 (lib/configAuthz.mts) に載せる。
 *
 * ★ 読んで分かったこと (2026-09-27):
 *   /logs         ログには全ルームの本文 (道具の結果 get_messages 等) が入る → ★ 管理者だけ
 *   /agent/cancel だれでも他人のルームの応答を止められ、そこにボットの「中断しました」が出る
 *                 → ★ そのルームのメンバー (と管理者) だけ
 *   /agent/identity, /agent/cc-projects  名前の一覧だけ。宛先の選択画面が全員に使う → ログインだけ
 * ★ 事実は利用者自身の鍵で本体 (GET /api/auth/authz) に聞き、判断は agent-server がする (#458 と同じ)。
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import { isAllowed, createConfigAuthz, classifyAgentRequest, classifyLogsRequest, type AuthzFacts } from '../../src/lib/configAuthz.mts';

const facts = (role: string, room: AuthzFacts['room'] = null): AuthzFacts => ({ user_id: 'u1', role, room });
const group = (member_role: string | null) => ({ id: 'r1', type: 'group', member_role });

describe('isAllowed — ★ member (そのルームに入っているか)', () => {
  test('★ 一般メンバーでも入っていれば通る (ルームの管理者でなくてよい)', () => {
    expect(isAllowed({ kind: 'member', roomId: 'r1' }, facts('user', group('member')))).toBe(true);
    expect(isAllowed({ kind: 'member', roomId: 'r1' }, facts('user', group('admin')))).toBe(true);
  });
  test('★★ 入っていない人 / 存在しないルームは断る', () => {
    expect(isAllowed({ kind: 'member', roomId: 'r1' }, facts('user', group(null)))).toBe(false);
    expect(isAllowed({ kind: 'member', roomId: 'x' }, facts('user', null))).toBe(false);
  });
  test('システム管理者は通る', () => {
    expect(isAllowed({ kind: 'member', roomId: 'r1' }, facts('admin', group(null)))).toBe(true);
  });
});

describe('classifyLogsRequest — ★ /logs はどの道も管理者だけ', () => {
  test.each(['/', '/dates', '/anything'])('%s', (p) => {
    expect(classifyLogsRequest({ method: 'GET', path: p })).toEqual({ kind: 'global' });
  });
});

describe('classifyAgentRequest — ★ /agent', () => {
  test('identity / cc-projects はログインだけ', () => {
    expect(classifyAgentRequest({ method: 'GET', path: '/identity' })).toEqual({ kind: 'open' });
    expect(classifyAgentRequest({ method: 'GET', path: '/cc-projects' })).toEqual({ kind: 'open' });
  });
  test('★★ cancel は body の room_id のメンバー', () => {
    expect(classifyAgentRequest({ method: 'POST', path: '/cancel', body: { room_id: 'r1' } }))
      .toEqual({ kind: 'member', roomId: 'r1' });
  });
  test('cancel で room_id が無いときは判断しない (ハンドラが 400 を返す)', () => {
    expect(classifyAgentRequest({ method: 'POST', path: '/cancel', body: {} })).toBeNull();
    expect(classifyAgentRequest({ method: 'POST', path: '/cancel' })).toBeNull();
  });
  test('★ 知らない道は管理者だけ (★ 足した道を黙って開けない)', () => {
    expect(classifyAgentRequest({ method: 'POST', path: '/something-new' })).toEqual({ kind: 'global' });
    expect(classifyAgentRequest({ method: 'POST', path: '/identity' })).toEqual({ kind: 'global' });
  });
});

describe('createConfigAuthz({ classify }) — ★ 分け方を差し替えられる', () => {
  type Res = { status: jest.Mock; json: jest.Mock };
  const mkRes = (): Res => { const r = { status: jest.fn(), json: jest.fn() } as Res; r.status.mockReturnValue(r); return r; };
  const serverSays = (body: unknown, status = 200) => jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  const mkReq = (p: string, body?: unknown, token = 'tok-A') => ({ method: 'POST', path: p, body, headers: { authorization: `Bearer ${token}` } });

  test('★★ member: 入っていないルームの cancel は 403、本体には room_id つきで聞く', async () => {
    const fetchImpl = serverSays(facts('user', group(null)));
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never, classify: classifyAgentRequest });
    const res = mkRes(); const next = jest.fn();
    await mw(mkReq('/cancel', { room_id: 'r1' }) as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('http://s/api/auth/authz?room_id=r1');
  });

  test('★ member: 入っていれば通る', async () => {
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: serverSays(facts('user', group('member'))) as never, classify: classifyAgentRequest });
    const next = jest.fn();
    await mw(mkReq('/cancel', { room_id: 'r1' }) as never, mkRes() as never, next);
    expect(next).toHaveBeenCalled();
  });

  test('判断しない (null) ときは本体に聞かずにハンドラへ渡す', async () => {
    const fetchImpl = serverSays(facts('user'));
    const mw = createConfigAuthz({ apiUrl: 'http://s', fetchImpl: fetchImpl as never, classify: classifyAgentRequest });
    const next = jest.fn();
    await mw(mkReq('/cancel', {}) as never, mkRes() as never, next);
    expect(next).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
