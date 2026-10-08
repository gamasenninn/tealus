import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('Message Delete API', () => {
  let user1: Awaited<ReturnType<typeof createTestUser>>;
  let user2: Awaited<ReturnType<typeof createTestUser>>;
  let roomId: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  describe('DELETE /api/rooms/:id/messages/:msgId', () => {
    it('should soft-delete own message', async () => {
      // Send a message
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '削除テスト' });
      const msgId = msgRes.body.message.id;

      // Delete it
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${msgId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);

      // Verify it shows as deleted in history
      const histRes = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      const deleted = histRes.body.messages.find((m: any) => m.id === msgId);
      expect(deleted.is_deleted).toBe(true);
    });

    // ★ #522 画像・動画・ファイルも、消したあとに部屋の一覧へファイルの場所を返していた (画面は隠していたが中身は配っていた)
    it('消した投稿には、一覧でファイルを付けない (他のメンバーから見ても)', async () => {
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '添付つき' });
      const msgId = msgRes.body.message.id;
      await getTestPool().query(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size) VALUES ($1, 'images/x.jpg', 'x.jpg', 'image/jpeg', 10)`,
        [msgId]
      );
      const before = await request(app).get(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${user2.token}`);
      expect(before.body.messages.find((m: any) => m.id === msgId).media.length).toBe(1);   // 消す前は付く

      await request(app).delete(`/api/rooms/${roomId}/messages/${msgId}`).set('Authorization', `Bearer ${user1.token}`);
      const after = await request(app).get(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${user2.token}`);
      const m = after.body.messages.find((x: any) => x.id === msgId);
      expect(m.is_deleted).toBe(true);
      expect(m.media).toEqual([]);
    });

    it('should reject deleting other users message', async () => {
      // user1 sends
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '他人のメッセージ' });

      // user2 tries to delete
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${msgRes.body.message.id}`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/00000000-0000-0000-0000-000000000000`);

      expect(res.status).toBe(401);
    });

    it('should reject non-member', async () => {
      const user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });

      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'テスト' });

      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${msgRes.body.message.id}`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });
  });
});
