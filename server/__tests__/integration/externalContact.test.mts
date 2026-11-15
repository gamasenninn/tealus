/**
 * 社外の窓口の印とお客様の部屋 (2026-11-13 小野さん判断「お客様の部屋のタブ」、docs/02 users.is_external_contact)
 * ★ EC サイトのお客様の発言は、中継の口座 (EC窓口) が代わりに投稿する。お客様本人の口座は無いので、
 *   「ゲストのいる部屋」では EC の部屋を絞れなかった。口座に印を付け、その口座かゲストがいる部屋を画面の「お客様」のタブにまとめる
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('社外の窓口の印とお客様の部屋', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let admin: TestUser, staff: TestUser, window: TestUser, guest: TestUser;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADM001', display_name: '管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
    staff = await createTestUser({ login_id: 'EMP001', display_name: '店の人' });
    window = await createTestUser({ login_id: 'ec-front', display_name: 'EC窓口' });
    guest = await createTestUser({ login_id: 'GST001', display_name: 'ゲスト' });
    await getTestPool().query("UPDATE users SET role = 'guest' WHERE id = $1", [guest.user.id]);
  });

  const makeRoom = async (by: TestUser, name: string, memberIds: string[]) =>
    (await request(app).post('/api/rooms').set('Authorization', `Bearer ${by.token}`).send({ name, member_ids: memberIds })).body.room.id as string;

  it('★ 管理者は口座に社外の窓口の印を付けられ、利用者の一覧に出る', async () => {
    const res = await request(app).put(`/api/admin/users/${window.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`).send({ is_external_contact: true });
    expect(res.status).toBe(200);
    expect(res.body.user.is_external_contact).toBe(true);
    const list = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${admin.token}`);
    expect(list.body.users.find((u: { id: string }) => u.id === window.user.id).is_external_contact).toBe(true);
  });

  it('印は真偽値だけ受け付ける', async () => {
    const res = await request(app).put(`/api/admin/users/${window.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`).send({ is_external_contact: 'yes' });
    expect(res.status).toBe(400);
  });

  it('★ 管理者でない人は印を付けられない', async () => {
    const res = await request(app).put(`/api/admin/users/${window.user.id}`)
      .set('Authorization', `Bearer ${staff.token}`).send({ is_external_contact: true });
    expect(res.status).toBe(403);
  });

  it('★ 部屋の一覧は、窓口の口座が作った部屋に has_external_contact、ゲストがいる部屋に has_guest を付ける', async () => {
    await getTestPool().query('UPDATE users SET is_external_contact = true WHERE id = $1', [window.user.id]);
    const ecRoom = await makeRoom(window, 'EC チャット お客様 #1', [staff.user.id]);
    const guestRoom = await makeRoom(staff, '社内とゲスト', [guest.user.id]);
    const plainRoom = await makeRoom(staff, '社内だけ', [admin.user.id]);

    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    const byId = (id: string) => res.body.rooms.find((r: { id: string }) => r.id === id);
    expect(byId(ecRoom)).toMatchObject({ has_external_contact: true, has_guest: false });
    expect(byId(guestRoom)).toMatchObject({ has_external_contact: false, has_guest: true });
    expect(byId(plainRoom)).toMatchObject({ has_external_contact: false, has_guest: false });
  });

  // ★ 2026-11-14 小野さん判断「EC窓口は社内のグループに入れたい」: 窓口が作った部屋だけがお客様の部屋。
  //   社内の人が作った部屋に窓口を入れても、その部屋は「お客様」に移らない (全員の「すべて」「グループ」から消えない)
  it('★★ 社内の人が作った部屋に窓口の口座を入れても、お客様の部屋にならない', async () => {
    await getTestPool().query('UPDATE users SET is_external_contact = true WHERE id = $1', [window.user.id]);
    const ecRoom = await makeRoom(window, 'ECゲスト #1', [staff.user.id]);
    const internal = await makeRoom(staff, '業務メモ', [admin.user.id, window.user.id]);

    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${staff.token}`);
    const byId = (id: string) => res.body.rooms.find((r: { id: string }) => r.id === id);
    expect(byId(ecRoom)).toMatchObject({ has_external_contact: true });
    expect(byId(internal)).toMatchObject({ has_external_contact: false });
  });

  it('★ 窓口が作った部屋でも、窓口が抜けたらお客様の部屋ではなくなる', async () => {
    await getTestPool().query('UPDATE users SET is_external_contact = true WHERE id = $1', [window.user.id]);
    const ecRoom = await makeRoom(window, 'ECゲスト #2', [staff.user.id, admin.user.id]);
    await getTestPool().query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [ecRoom, window.user.id]);

    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${staff.token}`);
    expect(res.body.rooms.find((r: { id: string }) => r.id === ecRoom)).toMatchObject({ has_external_contact: false });
  });

  // ★ 改善ループ 55 (外の目の指摘): 抜けて入り直したら戻る。作り手は created_by に残っているので、規則どおりならまたお客様の部屋
  it('★ 作った窓口が抜けて入り直すと、またお客様の部屋に戻る', async () => {
    await getTestPool().query('UPDATE users SET is_external_contact = true WHERE id = $1', [window.user.id]);
    const ecRoom = await makeRoom(window, 'ECゲスト #3', [staff.user.id]);
    await getTestPool().query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [ecRoom, window.user.id]);
    await getTestPool().query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [ecRoom, window.user.id]);

    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${staff.token}`);
    expect(res.body.rooms.find((r: { id: string }) => r.id === ecRoom)).toMatchObject({ has_external_contact: true });
  });

  // ★ 改善ループ 51: 見る人自身は数えない。数えると、ゲスト本人の画面では自分のいる部屋が全部「お客様」になり、
  //   窓口の口座で入ると「すべて」「グループ」が空になる
  it('★ 見る人自身が窓口・ゲストのときは、自分を数えない', async () => {
    await getTestPool().query('UPDATE users SET is_external_contact = true WHERE id = $1', [window.user.id]);
    const ecRoom = await makeRoom(window, 'EC チャット お客様 #2', [staff.user.id]);
    const guestRoom = await makeRoom(staff, '社内とゲスト', [guest.user.id]);

    const asWindow = await request(app).get('/api/rooms').set('Authorization', `Bearer ${window.token}`);
    expect(asWindow.body.rooms.find((r: { id: string }) => r.id === ecRoom)).toMatchObject({ has_external_contact: false });
    const asGuest = await request(app).get('/api/rooms').set('Authorization', `Bearer ${guest.token}`);
    expect(asGuest.body.rooms.find((r: { id: string }) => r.id === guestRoom)).toMatchObject({ has_guest: false });
    // 社内の人から見れば、どちらも今までどおり
    const asStaff = await request(app).get('/api/rooms').set('Authorization', `Bearer ${staff.token}`);
    expect(asStaff.body.rooms.find((r: { id: string }) => r.id === ecRoom)).toMatchObject({ has_external_contact: true });
    expect(asStaff.body.rooms.find((r: { id: string }) => r.id === guestRoom)).toMatchObject({ has_guest: true });
  });

  // ★ 2026-11-15 小野さん承認 (EC の Q0(15) の 1、docs/02 is_external_contact): 窓口の口座は、自分が作った部屋に社員を後から足せる。
  //   機械のアカウントは招待しない (改善ループ 13) のただ 1 つの例外。EC の店の人が後から増えると、前の部屋を見られなかった
  describe('窓口の口座が、自分の作った部屋に社員を後から足す', () => {
    let late: TestUser, bot: TestUser, window2: TestUser;
    beforeEach(async () => {
      // 本番の EC窓口は機械 (is_bot) で、窓口の印付き
      await getTestPool().query('UPDATE users SET is_bot = true, is_external_contact = true WHERE id = $1', [window.user.id]);
      late = await createTestUser({ login_id: 'EMP002', display_name: '後から来た店の人' });
      bot = await createTestUser({ login_id: 'bot-x', display_name: 'ほかの機械' });
      await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
      window2 = await createTestUser({ login_id: 'ec-front2', display_name: '別の窓口' });
      await getTestPool().query('UPDATE users SET is_bot = true, is_external_contact = true WHERE id = $1', [window2.user.id]);
    });
    const invite = (by: TestUser, roomId: string, userId: string, headers: Record<string, string> = {}) =>
      request(app).post(`/api/rooms/${roomId}/members`).set('Authorization', `Bearer ${by.token}`).set(headers).send({ user_id: userId });

    it('★★ 自分が作った部屋に、有効な社員を足せる', async () => {
      const ecRoom = await makeRoom(window, 'ECゲスト #1', [staff.user.id]);
      const res = await invite(window, ecRoom, late.user.id);
      expect(res.status).toBe(200);
      const m = await getTestPool().query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [ecRoom, late.user.id]);
      expect(m.rowCount).toBe(1);
    });

    it('既にメンバーなら 409 (5 分ごとの見回りはこれを正常として扱う)', async () => {
      const ecRoom = await makeRoom(window, 'ECゲスト #2', [staff.user.id]);
      expect((await invite(window, ecRoom, staff.user.id)).status).toBe(409);
    });

    it('★ 窓口の印の無い機械は、今までどおり足せない', async () => {
      const room = await makeRoom(bot, '機械の部屋', [staff.user.id]);
      expect((await invite(bot, room, late.user.id)).status).toBe(403);
    });

    it('★ 自分が作っていない部屋には足せない (窓口がメンバーでも)', async () => {
      const room = await makeRoom(staff, '社内の部屋', [window.user.id]);
      expect((await invite(window, room, late.user.id)).status).toBe(403);
      const other = await makeRoom(window2, 'ECゲスト 別の窓口', [window.user.id]);
      expect((await invite(window, other, late.user.id)).status).toBe(403);
    });

    it.each([
      ['ゲスト', 'guest'], ['機械', 'bot'], ['窓口', 'window2'], ['利用停止の人', 'inactive'],
    ])('★ %s は足せない', async (_label, who) => {
      const ecRoom = await makeRoom(window, 'ECゲスト #3', [staff.user.id]);
      let target = who === 'guest' ? guest : who === 'bot' ? bot : who === 'window2' ? window2 : late;
      if (who === 'inactive') await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [late.user.id]);
      const res = await invite(window, ecRoom, target.user.id);
      expect([403, 404]).toContain(res.status);
      const m = await getTestPool().query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [ecRoom, target.user.id]);
      expect(m.rowCount).toBe(0);
    });

    it('★ AI の道具の印 (依頼した人のヘッダ) が付いていたら断る', async () => {
      const ecRoom = await makeRoom(window, 'ECゲスト #4', [staff.user.id]);
      const res = await invite(window, ecRoom, late.user.id, { 'x-tealus-requester': staff.user.id });
      expect(res.status).toBe(403);
    });

    it('窓口の印を外したら、もう足せない', async () => {
      const ecRoom = await makeRoom(window, 'ECゲスト #5', [staff.user.id]);
      await getTestPool().query('UPDATE users SET is_external_contact = false WHERE id = $1', [window.user.id]);
      expect((await invite(window, ecRoom, late.user.id)).status).toBe(403);
    });
  });
});
