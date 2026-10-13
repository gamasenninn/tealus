/**
 * 他の部屋へ転送された投稿がある部屋を削除できなかった (改善ループ 10-13 の 2.)
 *
 * ★ 原因: messages.forwarded_from が messages(id) を参照し、ON DELETE が無かった (019_message_forward.sql)。
 *   部屋を消すと messages が CASCADE で消えるが、**別の部屋にある転送の写し**の参照に当たって失敗し、500 だけが返った。
 *   返信 (reply_to) も同じ形だが、返信は同じ部屋に限る (messageRefs) ので一緒に消えて問題にならない。
 * ★ 直し方: 参照の縛りだけ外す (ID は残す)。写しは残り、画面は既にある
 *   「📤 転送メッセージ（元メッセージは削除されました）」を出す (転送元を空にすると「転送」の印ごと消える)
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('転送された投稿がある部屋の削除', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); });

  it('★ 部屋を削除できる。別の部屋の転送の写しは残り、元は「削除された」扱いになる', async () => {
    const u = await createTestUser({ login_id: 'EMP601', display_name: '転送する人' });
    const auth = { Authorization: `Bearer ${u.token}` };
    const roomA = (await request(app).post('/api/rooms').set(auth).send({ name: '消す部屋', member_ids: [] })).body.room.id;
    const roomB = (await request(app).post('/api/rooms').set(auth).send({ name: '残る部屋', member_ids: [] })).body.room.id;

    const orig = (await request(app).post(`/api/rooms/${roomA}/messages`).set(auth).send({ content: '元の投稿' })).body.message;
    const fwd = await request(app).post(`/api/rooms/${roomB}/messages`).set(auth).send({ content: '元の投稿', forwarded_from: orig.id });
    expect(fwd.status).toBe(201);

    const del = await request(app).delete(`/api/rooms/${roomA}`).set(auth);
    expect(del.status).toBeLessThan(300);
    expect((await getTestPool().query('SELECT 1 FROM rooms WHERE id = $1', [roomA])).rowCount).toBe(0);

    const list = await request(app).get(`/api/rooms/${roomB}/messages`).set(auth);
    const copy = list.body.messages.find((m: { id: string }) => m.id === fwd.body.message.id);
    expect(copy.content).toBe('元の投稿');
    expect(copy.forwarded_from).toBe(orig.id);       // ★ 転送の印は残る
    expect(copy.forwarded_from_message).toBeNull();   // 元は無い = 画面は「元メッセージは削除されました」
  });

  it('★ 参照の縛りを外しても、存在しない投稿を転送元にして投稿はできない (アプリ側で確かめている)', async () => {
    const u = await createTestUser({ login_id: 'EMP602', display_name: '転送する人' });
    const auth = { Authorization: `Bearer ${u.token}` };
    const roomB = (await request(app).post('/api/rooms').set(auth).send({ name: '部屋', member_ids: [] })).body.room.id;
    const res = await request(app).post(`/api/rooms/${roomB}/messages`).set(auth)
      .send({ content: 'x', forwarded_from: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
