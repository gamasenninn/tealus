/**
 * 削除した投稿の本文を退避し、管理者だけが見て・戻せる (2026-10-30 利用者判断 3、docs/02 deleted_message_contents)
 *
 * ★ 削除で本文を null にしていたので、誤って消した本文が戻せず、誰が消したかも 14 日でログから消えた
 *   (30 日 20 件、15 件は送って 1 分以内 = 送信の取り消し)。
 * ★ messages.content は今までどおり null (検索・AI・配信の口は変えない)。退避は別の表
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('削除した本文の退避と、管理者による確認・戻し', () => {
  let admin: TestUser, member: TestUser, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADM001', display_name: '管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
    member = await createTestUser({ login_id: 'EMP001', display_name: '田中' });
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${member.token}`)
      .send({ name: '部屋', member_ids: [] })).body.room.id;
  });

  const post = async (content: string) => (await request(app).post(`/api/rooms/${roomId}/messages`)
    .set('Authorization', `Bearer ${member.token}`).send({ content })).body.message.id as string;
  const del = (id: string) => request(app).delete(`/api/rooms/${roomId}/messages/${id}`).set('Authorization', `Bearer ${member.token}`);

  it('★★ 削除すると messages の本文は今までどおり消え、退避の表に本文と誰が・いつが残る', async () => {
    const id = await post('間違えて送った');
    expect((await del(id)).status).toBe(200);
    const m = (await getTestPool().query('SELECT is_deleted, content FROM messages WHERE id = $1', [id])).rows[0];
    expect(m).toEqual({ is_deleted: true, content: null });
    const d = (await getTestPool().query('SELECT content, deleted_by, deleted_at FROM deleted_message_contents WHERE message_id = $1', [id])).rows[0];
    expect(d.content).toBe('間違えて送った');
    expect(d.deleted_by).toBe(member.user.id);
    expect(d.deleted_at).toBeTruthy();
  });

  it('★★ 管理者は一覧で見られる (部屋名・送った人・消した人つき)', async () => {
    const id = await post('秘密ではないが消した');
    await del(id);
    const res = await request(app).get('/api/admin/deleted-messages').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.messages[0]).toMatchObject({
      message_id: id, content: '秘密ではないが消した', room_name: '部屋',
      sender_display_name: '田中', deleted_by_display_name: '田中',
    });
  });

  it('★★ 管理者以外は見られない', async () => {
    const res = await request(app).get('/api/admin/deleted-messages').set('Authorization', `Bearer ${member.token}`);
    expect(res.status).toBe(403);
  });

  it('★★ 管理者が戻すと、本文が戻り削除の印が外れ、退避の行は消える', async () => {
    const id = await post('戻してほしい');
    await del(id);
    const res = await request(app).post(`/api/admin/deleted-messages/${id}/restore`).set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const m = (await getTestPool().query('SELECT is_deleted, content FROM messages WHERE id = $1', [id])).rows[0];
    expect(m).toEqual({ is_deleted: false, content: '戻してほしい' });
    expect((await getTestPool().query('SELECT 1 FROM deleted_message_contents WHERE message_id = $1', [id])).rowCount).toBe(0);
  });

  it('退避の無い投稿 (043 より前に消したもの) は戻せない (404)', async () => {
    const id = await post('古い削除');
    await getTestPool().query('UPDATE messages SET is_deleted = true, content = null WHERE id = $1', [id]);
    const res = await request(app).post(`/api/admin/deleted-messages/${id}/restore`).set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });
});
