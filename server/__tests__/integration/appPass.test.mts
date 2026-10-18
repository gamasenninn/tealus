/**
 * #607 POST /api/rooms/:id/app-pass (docs/11 §5.2)。通行証を出すのは「その部屋のメンバー」で、
 * 「通行証を添える」が付いたアプリで、鍵のあるサイトのときだけ。
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

const KEY_HEX = 'ab'.repeat(32);
const APP = 'https://apps.example.com/close/qrpos/?pmode=tana#top';

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

describe('POST /api/rooms/:id/app-pass', () => {
  let member: TestUser, outsider: TestUser;
  let roomId: string;
  let keyDir: string;
  const savedDir = process.env.APP_PASS_KEY_DIR;

  beforeAll(async () => {
    await setupTestDb();
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apppass-int-'));
    process.env.APP_PASS_KEY_DIR = keyDir;
  });

  afterAll(async () => {
    if (savedDir === undefined) delete process.env.APP_PASS_KEY_DIR; else process.env.APP_PASS_KEY_DIR = savedDir;
    fs.rmSync(keyDir, { recursive: true, force: true });
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    fs.writeFileSync(path.join(keyDir, 'apps.example.com.key'), KEY_HEX);
    member = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    outsider = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    const res = await request(app).post('/api/rooms')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ name: '棚卸', member_ids: [] });
    roomId = res.body.room.id;
    await setApps([
      { title: '棚卸入力', url: APP, pass: true },
      { title: '通行証なし', url: 'https://apps.example.com/close/list.html', pass: false },
      { title: '平文', url: 'http://apps.example.com/close/', pass: true },
      { title: '鍵なし', url: 'https://nokey.example.com/close/', pass: true },
    ]);
  });

  async function setApps(apps: unknown[]): Promise<void> {
    await getTestPool().query('UPDATE rooms SET app_urls = $1 WHERE id = $2', [JSON.stringify(apps), roomId]);
  }

  /** ★ 口が無くても 404 になるので、理由の文まで見る (でないと「出さない」系が素通りする) */
  const NO_PASS = 'このアプリには通行証を出せません';
  const expectNoPass = (res: request.Response) => { expect(res.status).toBe(404); expect(res.body.error).toBe(NO_PASS); };

  const post = (user: TestUser, body: object) => request(app)
    .post(`/api/rooms/${roomId}/app-pass`)
    .set('Authorization', `Bearer ${user.token}`)
    .send(body);

  it('メンバーには、入口 /tealus-gate/ の URL と、検証できる通行証を返す', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await post(member, { index: 0, url: APP });
    expect(res.status).toBe(200);

    const u = new URL(res.body.url);
    expect(`${u.origin}${u.pathname}`).toBe('https://apps.example.com/tealus-gate/');
    expect(u.hash).toBe('#top');
    const token = u.searchParams.get('tealus_pass')!;
    const [v, body, sig] = token.split('.');
    expect(v).toBe('v1');
    // ★ 相手側と同じ手順で確かめる: 署名 → 中身
    const expected = crypto.createHmac('sha256', Buffer.from(KEY_HEX, 'hex')).update(`v1.${body}`).digest();
    expect(b64urlDecode(sig).equals(expected)).toBe(true);
    const claims = JSON.parse(b64urlDecode(body).toString('utf8'));
    expect(claims).toMatchObject({
      v: 1, aud: 'https://apps.example.com', room: roomId, sub: member.user.id, name: '田中太郎', to: '/close/qrpos/?pmode=tana',
    });
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.exp - claims.iat).toBe(120);
  });

  it('★ メンバーでない人には出さない (403)', async () => {
    const res = await post(outsider, { index: 0, url: APP });
    expect(res.status).toBe(403);
    expect(res.body.url).toBeUndefined();
  });

  it('「通行証を添える」が付いていないアプリには出さない', async () => {
    expectNoPass(await post(member, { index: 1, url: 'https://apps.example.com/close/list.html' }));
  });

  it('★ url が今の並びと合わなければ出さない (開いている間に並べ替えられたとき)', async () => {
    expectNoPass(await post(member, { index: 0, url: 'https://apps.example.com/close/list.html' }));
  });

  it('無い番号・形の崩れた本文には出さない', async () => {
    expectNoPass(await post(member, { index: 9, url: APP }));
    expect((await post(member, { index: '0', url: APP })).status).toBe(400);
    expect((await post(member, { index: 0 })).status).toBe(400);
  });

  it('http: のアプリには出さない', async () => {
    expectNoPass(await post(member, { index: 2, url: 'http://apps.example.com/close/' }));
  });

  it('鍵の無いサイトには出さない (= 取り決めが無い)', async () => {
    expectNoPass(await post(member, { index: 3, url: 'https://nokey.example.com/close/' }));
  });

  it('★ 機械のアカウント (is_bot) には、メンバーでも出さない', async () => {
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [member.user.id]);
    expectNoPass(await post(member, { index: 0, url: APP }));
  });

  it('★ 出すたびに新しい通行証 (使い切りではないが、毎回作り直す)', async () => {
    const a = (await post(member, { index: 0, url: APP })).body.url;
    await new Promise((r) => setTimeout(r, 1100));
    const b = (await post(member, { index: 0, url: APP })).body.url;
    expect(a).not.toBe(b);
  });
});

/**
 * #607 ホーム画面のタブ (portal_links) にも通行証を出す (docs/11 §5.4)。
 * ★ 部屋のアプリだけに付けていて、ホームの社内ポータルが相手側の案内ページになった (改善ループ 8 回目の A)。
 *   通す範囲は「タブが見えている人」= ゲストを除くログイン中の人 (#282)。機械は除く
 */
describe('POST /api/rooms/portal-links/:id/app-pass', () => {
  let user: TestUser;
  let keyDir: string;
  const savedDir = process.env.APP_PASS_KEY_DIR;
  const NO_PASS = 'このアプリには通行証を出せません';

  beforeAll(async () => {
    await setupTestDb();
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apppass-portal-'));
    process.env.APP_PASS_KEY_DIR = keyDir;
  });

  afterAll(async () => {
    if (savedDir === undefined) delete process.env.APP_PASS_KEY_DIR; else process.env.APP_PASS_KEY_DIR = savedDir;
    fs.rmSync(keyDir, { recursive: true, force: true });
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    await getTestPool().query('DELETE FROM portal_links');
    fs.writeFileSync(path.join(keyDir, 'apps.example.com.key'), KEY_HEX);
    user = await createTestUser({ login_id: 'EMP010', display_name: '佐藤次郎' });
  });

  async function addLink(url: string, pass: boolean, isActive = true): Promise<string> {
    const r = await getTestPool().query<{ id: string }>(
      'INSERT INTO portal_links (title, url, pass, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
      ['社内ポータル', url, pass, isActive],
    );
    return r.rows[0].id;
  }

  const post = (u: TestUser, id: string) => request(app)
    .post(`/api/rooms/portal-links/${id}/app-pass`)
    .set('Authorization', `Bearer ${u.token}`)
    .send({});

  it('ログイン中の人には、入口の URL と検証できる通行証を返す (room は "home")', async () => {
    const id = await addLink('https://apps.example.com/close/', true);
    const res = await post(user, id);
    expect(res.status).toBe(200);
    const u = new URL(res.body.url);
    expect(`${u.origin}${u.pathname}`).toBe('https://apps.example.com/tealus-gate/');
    const [, body, sig] = u.searchParams.get('tealus_pass')!.split('.');
    const expected = crypto.createHmac('sha256', Buffer.from(KEY_HEX, 'hex')).update(`v1.${body}`).digest();
    expect(b64urlDecode(sig).equals(expected)).toBe(true);
    expect(JSON.parse(b64urlDecode(body).toString('utf8'))).toMatchObject({
      aud: 'https://apps.example.com', room: 'home', sub: user.user.id, name: '佐藤次郎', to: '/close/',
    });
  });

  it('★ ゲストには出さない (タブ自体がゲストには見えない #282)', async () => {
    const id = await addLink('https://apps.example.com/close/', true);
    await getTestPool().query("UPDATE users SET role = 'guest' WHERE id = $1", [user.user.id]);
    const res = await post(user, id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe(NO_PASS);
  });

  it('★ 機械のアカウントには出さない', async () => {
    const id = await addLink('https://apps.example.com/close/', true);
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [user.user.id]);
    const res = await post(user, id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe(NO_PASS);
  });

  it('印の無いリンク・止めたリンク・無いリンク・鍵の無いサイトには出さない', async () => {
    const noPass = await addLink('https://apps.example.com/close/', false);
    const inactive = await addLink('https://apps.example.com/close/', true, false);
    const noKey = await addLink('https://nokey.example.com/close/', true);
    for (const id of [noPass, inactive, noKey, '00000000-0000-0000-0000-000000000000']) {
      const res = await post(user, id);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(NO_PASS);
    }
  });

  it('形の崩れた ID は 400', async () => {
    const res = await post(user, 'not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('管理者は PUT /api/admin/portal-links/:id で pass を付け外しできる (真偽値だけ)', async () => {
    const id = await addLink('https://apps.example.com/close/', false);
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [user.user.id]);
    const put = (body: object) => request(app).put(`/api/admin/portal-links/${id}`)
      .set('Authorization', `Bearer ${user.token}`).send(body);
    const on = await put({ pass: true });
    expect(on.status).toBe(200);
    expect(on.body.link.pass).toBe(true);
    expect((await put({ pass: 'yes' })).status).toBe(400);
  });

  it('管理者は登録のときにも pass を付けられる (付けなければ false)', async () => {
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [user.user.id]);
    const create = (body: object) => request(app).post('/api/admin/portal-links')
      .set('Authorization', `Bearer ${user.token}`).send({ title: 't', url: 'https://apps.example.com/close/', ...body });
    expect((await create({ pass: true })).body.link.pass).toBe(true);
    expect((await create({})).body.link.pass).toBe(false);
    expect((await create({ pass: 1 })).status).toBe(400);
  });

  it('ホームのタブの一覧に pass が載る (画面が通行証を取るかを決めるため)', async () => {
    await addLink('https://apps.example.com/close/', true);
    const res = await request(app).get('/api/rooms/portal-links').set('Authorization', `Bearer ${user.token}`);
    expect(res.body.links[0].pass).toBe(true);
  });
});
