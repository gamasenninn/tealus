/**
 * POST /api/sso/app-login (docs/11 §5.5、2026-11-17)。ブラウザから「Tealus でログイン」のための、ログイン専用の札。
 * ★ 戻り先は引数で受けず、本体の設定 (APP_LOGIN_TARGETS) の許可表だけが持つ。札には種類 (typ) と相手の合言葉 (state)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const KEY_HEX = 'cd'.repeat(32);
const AUD = 'https://portal.example.com';
const STATE = '0123456789abcdef0123456789abcdef';
const NO_LOGIN = 'このサイトにはログインの札を出せません';

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

describe('POST /api/sso/app-login', () => {
  let user: TestUser;
  let keyDir: string;
  const saved = { dir: process.env.APP_PASS_KEY_DIR, targets: process.env.APP_LOGIN_TARGETS };

  beforeAll(async () => {
    await setupTestDb();
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'applogin-int-'));
    process.env.APP_PASS_KEY_DIR = keyDir;
  });

  afterAll(async () => {
    for (const [k, v] of [['APP_PASS_KEY_DIR', saved.dir], ['APP_LOGIN_TARGETS', saved.targets]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(keyDir, { recursive: true, force: true });
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    fs.writeFileSync(path.join(keyDir, 'portal.example.com.key'), KEY_HEX);
    process.env.APP_LOGIN_TARGETS = `${AUD}|/auth/?a=tcallback, https://nokey.example.com|/auth/`;
    user = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
  });

  const post = (u: TestUser | null, body: object) => {
    const r = request(app).post('/api/sso/app-login');
    if (u) r.set('Authorization', `Bearer ${u.token}`);
    return r.send(body);
  };
  const expectNoLogin = (res: request.Response) => { expect(res.status).toBe(404); expect(res.body.error).toBe(NO_LOGIN); };

  it('★ 決まった戻り先に、署名を確かめられる login の札を付けて返す', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await post(user, { aud: AUD, state: STATE });
    expect(res.status).toBe(200);

    const u = new URL(res.body.url);
    expect(`${u.origin}${u.pathname}`).toBe('https://portal.example.com/auth/');
    expect(u.searchParams.get('a')).toBe('tcallback');
    const token = u.searchParams.get('tealus_login')!;
    const [v, body, sig] = token.split('.');
    expect(v).toBe('v1');
    const expected = crypto.createHmac('sha256', Buffer.from(KEY_HEX, 'hex')).update(`v1.${body}`).digest();
    expect(b64urlDecode(sig).equals(expected)).toBe(true);

    const claims = JSON.parse(b64urlDecode(body).toString('utf8'));
    expect(claims).toMatchObject({ v: 1, typ: 'login', aud: AUD, sub: user.user.id, name: '田中太郎', state: STATE });
    expect(claims.exp - claims.iat).toBe(60);
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    // ★ ログインは部屋にも行き先にも結びつかない
    expect(claims).not.toHaveProperty('room');
    expect(claims).not.toHaveProperty('to');
  });

  it('★ 許可表に無い aud には出さない (完全一致。末尾の / や大文字違いも別物)', async () => {
    for (const aud of ['https://evil.example.com', `${AUD}/`, 'https://PORTAL.example.com', 'http://portal.example.com', `${AUD}.evil.com`]) {
      expectNoLogin(await post(user, { aud, state: STATE }));
    }
  });

  it('★ 戻り先を引数で渡されても使わない', async () => {
    const res = await post(user, { aud: AUD, state: STATE, redirect: 'https://evil.example.com/', to: '//evil.example.com' });
    expect(res.status).toBe(200);
    expect(new URL(res.body.url).origin).toBe(AUD);
  });

  it('state は 32 桁の小文字の 16 進だけ (400)', async () => {
    for (const state of [undefined, '', 'x'.repeat(32), STATE.toUpperCase(), STATE + '0', 123]) {
      const res = await post(user, { aud: AUD, state });
      expect(res.status).toBe(400);
    }
  });

  it('許可表にあっても鍵が無ければ出さない', async () => {
    expectNoLogin(await post(user, { aud: 'https://nokey.example.com', state: STATE }));
  });

  it('許可表が空なら誰にも出さない', async () => {
    delete process.env.APP_LOGIN_TARGETS;
    expectNoLogin(await post(user, { aud: AUD, state: STATE }));
  });

  it('★ ゲストと機械のアカウントには出さない', async () => {
    await getTestPool().query("UPDATE users SET role = 'guest' WHERE id = $1", [user.user.id]);
    expectNoLogin(await post(user, { aud: AUD, state: STATE }));
    await getTestPool().query("UPDATE users SET role = 'user', is_bot = true WHERE id = $1", [user.user.id]);
    expectNoLogin(await post(user, { aud: AUD, state: STATE }));
  });

  it('ログインしていなければ 401', async () => {
    const res = await post(null, { aud: AUD, state: STATE });
    expect(res.status).toBe(401);
  });
});
