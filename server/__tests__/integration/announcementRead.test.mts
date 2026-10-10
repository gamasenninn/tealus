/**
 * #551 お知らせの部屋は、メンバーでない人 (ゲストを除く) も既読を付けられる。
 * ★ ホームのお知らせはメンバーかどうかに関係なく出るのに、既読の口はメンバーだけで 403 になり、未読の点が消えなかった
 *   (14 日で 57 件、朝礼・終礼が 53 件)
 * ★ 利用者の判断 (10-10): お知らせの部屋の「既読 N」に、ホームで見た人も数える
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('お知らせの既読 (#551)', () => {
  let owner: TestUser, outsider: TestUser, guest: TestUser, roomId: string, msgId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const pool = getTestPool();
    owner = await createTestUser({ login_id: 'EMP551', display_name: '発信者' });
    outsider = await createTestUser({ login_id: 'EMP552', display_name: 'メンバー外' });
    guest = await createTestUser({ login_id: 'GST553', display_name: 'ゲスト' });
    await pool.query("UPDATE users SET role = 'guest' WHERE id = $1", [guest.user.id]);
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '朝礼', member_ids: [] })).body.room.id;
    await pool.query('UPDATE rooms SET is_announcement = true WHERE id = $1', [roomId]);
    msgId = (await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type, is_published) VALUES ($1, $2, 'お知らせ', 'text', true) RETURNING id`,
      [roomId, owner.user.id])).rows[0].id;
  });

  const unread = async (u: TestUser) => {
    const res = await request(app).get('/api/rooms/announcements').set('Authorization', `Bearer ${u.token}`);
    return res.body.messages.find((m: { id: string }) => m.id === msgId)?.is_unread;
  };

  test('★ メンバーでない人がホームで既読にすると、未読の点が消える', async () => {
    expect(await unread(outsider)).toBe(true);
    const res = await request(app).post(`/api/rooms/${roomId}/read`).set('Authorization', `Bearer ${outsider.token}`)
      .send({ message_ids: [msgId] });
    expect(res.status).toBe(200);
    expect(await unread(outsider)).toBe(false);
  });

  test('★ 利用者の判断どおり、部屋の「既読 N」に数える', async () => {
    await request(app).post(`/api/rooms/${roomId}/read`).set('Authorization', `Bearer ${outsider.token}`).send({ message_ids: [msgId] });
    const res = await request(app).get(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${owner.token}`);
    expect(res.body.messages.find((m: { id: string }) => m.id === msgId).read_count).toBe(1);
  });

  test('公開されていない投稿の位置までは進められない (ホームに出ないもの)', async () => {
    const draft = (await getTestPool().query(
      `INSERT INTO messages (room_id, sender_id, content, type, is_published, created_at)
       VALUES ($1, $2, '下書き', 'text', false, now() + interval '1 minute') RETURNING id`,
      [roomId, owner.user.id])).rows[0].id;
    await request(app).post(`/api/rooms/${roomId}/read`).set('Authorization', `Bearer ${outsider.token}`).send({ message_ids: [draft] });
    expect(await unread(outsider)).toBe(true);
  });

  test('ゲストは今までどおり 403 (お知らせも出ない)', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/read`).set('Authorization', `Bearer ${guest.token}`).send({ message_ids: [msgId] });
    expect(res.status).toBe(403);
  });

  test('お知らせでない部屋は、メンバーでなければ今までどおり 403', async () => {
    await getTestPool().query('UPDATE rooms SET is_announcement = false WHERE id = $1', [roomId]);
    const res = await request(app).post(`/api/rooms/${roomId}/read`).set('Authorization', `Bearer ${outsider.token}`).send({ message_ids: [msgId] });
    expect(res.status).toBe(403);
  });

  test('「すべて既読」はメンバーだけのまま', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/read/all`).set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });
});
