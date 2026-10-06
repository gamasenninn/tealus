import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { pool } from '../../src/db/pool.mts';

describe('Messages API', () => {
  let user1: Awaited<ReturnType<typeof createTestUser>>;
  let user2: Awaited<ReturnType<typeof createTestUser>>;
  let user3: Awaited<ReturnType<typeof createTestUser>>;
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
    user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });

    // Create a group room with user1 and user2
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  // ============================================
  // POST /api/rooms/:id/messages
  // ============================================
  describe('POST /api/rooms/:id/messages', () => {
    it('should send a text message', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'こんにちは！' });

      expect(res.status).toBe(201);
      expect(res.body.message.content).toBe('こんにちは！');
      expect(res.body.message.sender_id).toBe(user1.user.id);
      expect(res.body.message.room_id).toBe(roomId);
      expect(res.body.message.type).toBe('text');
    });

    it('should reject empty message', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '' });

      expect(res.status).toBe(400);
    });

    it('should reject non-member from sending', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user3.token}`)
        .send({ content: '侵入メッセージ' });

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .send({ content: 'no auth' });

      expect(res.status).toBe(401);
    });
  });

  // ============================================
  // GET /api/rooms/:id/messages
  // ============================================
  describe('GET /api/rooms/:id/messages', () => {
    beforeEach(async () => {
      // Send multiple messages
      for (let i = 1; i <= 25; i++) {
        await request(app)
          .post(`/api/rooms/${roomId}/messages`)
          .set('Authorization', `Bearer ${user1.token}`)
          .send({ content: `メッセージ${i}` });
      }
    });

    it('#485-1 各メッセージにサーバーの時間帯で読める時刻 created_at_local を添える (AI が UTC を書き写さないように)', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      for (const m of res.body.messages) {
        const utc = new Date(m.created_at);
        const jst = new Date(utc.getTime() + 9 * 3600 * 1000);
        const want = `${jst.toISOString().slice(0, 10)} ${jst.toISOString().slice(11, 16)} (Asia/Tokyo)`;
        expect(m.created_at_local).toBe(want);
      }
    });

    it('should return messages (default limit 20)', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(20);
      // Should be newest first
      expect(res.body.messages[0].content).toBe('メッセージ25');
    });

    it('should support pagination with cursor', async () => {
      const page1 = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      const lastMessage = page1.body.messages[page1.body.messages.length - 1];

      const page2 = await request(app)
        .get(`/api/rooms/${roomId}/messages?before=${lastMessage.id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(page2.status).toBe(200);
      expect(page2.body.messages).toHaveLength(5); // 25 - 20 = 5
      expect(page2.body.messages[0].content).toBe('メッセージ5');
    });

    it('#511 after: 基準より新しい投稿を古い順に返す (日付へ飛んだあと下へ読み足す)', async () => {
      const latest = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);
      // 新しい順の 20 件。末尾が メッセージ6
      const sixth = latest.body.messages[latest.body.messages.length - 1];
      expect(sixth.content).toBe('メッセージ6');

      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages?after=${sixth.id}&limit=5`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages.map((m: { content: string }) => m.content))
        .toEqual(['メッセージ7', 'メッセージ8', 'メッセージ9', 'メッセージ10', 'メッセージ11']);
    });

    it('#511 after: 最新を基準にすると何も返らない (読み足しの終わり)', async () => {
      const latest = await request(app)
        .get(`/api/rooms/${roomId}/messages?limit=1`)
        .set('Authorization', `Bearer ${user1.token}`);
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages?after=${latest.body.messages[0].id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });

    it('#511 after: 同じ時刻の投稿も取りこぼさない (時刻だけで比べると落ちる)', async () => {
      const latest = await request(app)
        .get(`/api/rooms/${roomId}/messages?limit=3`)
        .set('Authorization', `Bearer ${user1.token}`);
      const [m25, m24, m23] = latest.body.messages;
      // 3 件を同じ時刻にそろえる
      await pool.query('UPDATE messages SET created_at = $1 WHERE id = ANY($2)', [m23.created_at, [m23.id, m24.id, m25.id]]);
      const ordered = [m23.id, m24.id, m25.id].sort();

      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages?after=${ordered[0]}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages.map((m: { id: string }) => m.id)).toEqual(ordered.slice(1));
    });

    it('should support custom limit', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages?limit=5`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages).toHaveLength(5);
    });

    it('should reject non-member from reading', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });

    it('should include sender info', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages?limit=1`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages[0].sender_display_name).toBe('田中太郎');
    });
  });
});
