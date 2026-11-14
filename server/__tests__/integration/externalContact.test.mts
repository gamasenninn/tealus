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

  it('★ 部屋の一覧は、窓口の口座がいる部屋に has_external_contact、ゲストがいる部屋に has_guest を付ける', async () => {
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
});
