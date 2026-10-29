/**
 * お知らせに公開できるのは、ホームで読める種類だけ (2026-10-29 小野さん判断「9 絞る」)
 *
 * ★ 以前は system 以外すべてを公開でき、スタンプ (中身はスタンプの ID) やフォーム (中身は JSON) が
 *   ホームのお知らせに生のまま並んだ。公開を外す (非公開にする) のは種類によらずできる
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('お知らせに公開できる種類', () => {
  let owner: TestUser, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    owner = await createTestUser({ login_id: 'EMP901', display_name: '発信者' });
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '朝礼', member_ids: [] })).body.room.id;
    await getTestPool().query('UPDATE rooms SET is_announcement = true WHERE id = $1', [roomId]);
  });

  const insert = async (type: string, published = false) => (await getTestPool().query(
    'INSERT INTO messages (room_id, sender_id, content, type, is_published) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [roomId, owner.user.id, 'x', type, published])).rows[0].id as string;
  const publish = (id: string, is_published: boolean) => request(app)
    .patch(`/api/rooms/${roomId}/messages/${id}/publish`).set('Authorization', `Bearer ${owner.token}`).send({ is_published });

  it.each(['text', 'image', 'video', 'file', 'voice'])('★ %s は公開できる', async (type) => {
    expect((await publish(await insert(type), true)).status).toBe(200);
  });

  it.each(['stamp', 'form'])('★★ %s は公開できない (400)', async (type) => {
    const res = await publish(await insert(type), true);
    expect(res.status).toBe(400);
  });

  it('★ 公開済みのスタンプ (以前に公開したもの) は、非公開にはできる', async () => {
    expect((await publish(await insert('stamp', true), false)).status).toBe(200);
  });
});
