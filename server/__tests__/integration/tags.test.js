const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Tags API', () => {
  let user1, user2, roomId, messageId;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ employee_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ employee_id: 'EMP002', display_name: '鈴木花子' });

    // Create room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;

    // Create message
    const msgRes = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: 'テストメッセージ' });
    messageId = msgRes.body.message.id;
  });

  // ============================================
  // POST /api/rooms/:id/tags — タグ作成
  // ============================================
  describe('POST /api/rooms/:id/tags', () => {
    it('should create a tag', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '合宿' });

      expect(res.status).toBe(201);
      expect(res.body.tag.name).toBe('合宿');
      expect(res.body.tag.room_id).toBe(roomId);
    });

    it('should return existing tag if duplicate name', async () => {
      await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '合宿' });

      const res = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '合宿' });

      expect(res.status).toBe(200);
      expect(res.body.tag.name).toBe('合宿');
    });

    it('should reject empty name', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('should reject non-member', async () => {
      const user3 = await createTestUser({ employee_id: 'EMP003', display_name: '佐藤次郎' });
      const res = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user3.token}`)
        .send({ name: 'テスト' });

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // GET /api/rooms/:id/tags — ルーム内タグ一覧
  // ============================================
  describe('GET /api/rooms/:id/tags', () => {
    it('should return tags with usage count', async () => {
      // Create tags
      const tag1Res = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '合宿' });

      await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'UI設計' });

      // Tag a message
      await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tag1Res.body.tag.id });

      const res = await request(app)
        .get(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      // デフォルト TODO タグ + 手動作成2つ = 3つ（ただし usage_count 順）
      expect(res.body.tags.length).toBeGreaterThanOrEqual(2);
      // 使用中のタグが先に来る
      const usedTag = res.body.tags.find(t => t.name === '合宿');
      expect(usedTag).toBeDefined();
      expect(usedTag.usage_count).toBe(1);
    });

    it('should return empty array for no tags', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      // デフォルト TODO タグが存在するので完全に空にはならない
      const nonTodoTags = res.body.tags.filter(t => !t.is_todo);
      expect(nonTodoTags).toEqual([]);
    });
  });

  // ============================================
  // GET /api/rooms/:id/tags/suggest?q= — サジェスト
  // ============================================
  describe('GET /api/rooms/:id/tags/suggest', () => {
    it('should suggest tags by prefix', async () => {
      await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '合宿' });

      await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '合同会議' });

      await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'UI設計' });

      const res = await request(app)
        .get(`/api/rooms/${roomId}/tags/suggest?q=合`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.tags.length).toBe(2);
      expect(res.body.tags.every(t => t.name.startsWith('合'))).toBe(true);
    });
  });

  // ============================================
  // POST /api/messages/:id/tags — メッセージにタグ付け
  // ============================================
  describe('POST /api/messages/:id/tags', () => {
    it('should add a tag to a message', async () => {
      const tagRes = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '重要' });

      const res = await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tagRes.body.tag.id });

      expect(res.status).toBe(201);
    });

    it('should add tag by name (auto-create)', async () => {
      const res = await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '新しいタグ' });

      expect(res.status).toBe(201);
      expect(res.body.tag.name).toBe('新しいタグ');
    });

    it('should not duplicate tag on same message', async () => {
      const tagRes = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'テスト' });

      await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tagRes.body.tag.id });

      const res = await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tagRes.body.tag.id });

      expect(res.status).toBe(200); // idempotent
    });
  });

  // ============================================
  // DELETE /api/messages/:id/tags/:tagId — タグ解除
  // ============================================
  describe('DELETE /api/messages/:id/tags/:tagId', () => {
    it('should remove a tag from a message', async () => {
      const tagRes = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '削除テスト' });

      await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tagRes.body.tag.id });

      const res = await request(app)
        .delete(`/api/messages/${messageId}/tags/${tagRes.body.tag.id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
    });
  });

  // ============================================
  // GET /api/messages/:id/tags — メッセージのタグ取得
  // ============================================
  describe('GET /api/messages/:id/tags', () => {
    it('should return tags on a message', async () => {
      const tag1 = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'タグA' });

      const tag2 = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'タグB' });

      await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tag1.body.tag.id });

      await request(app)
        .post(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tag2.body.tag.id });

      const res = await request(app)
        .get(`/api/messages/${messageId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.tags.length).toBe(2);
    });
  });

  // ============================================
  // GET /api/rooms/:id/media — メディアギャラリー
  // ============================================
  describe('GET /api/rooms/:id/media/gallery', () => {
    it('should return media files in the room', async () => {
      // Insert media message directly
      const pool = getTestPool();
      const msgRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type)
         VALUES ($1, $2, '', 'image') RETURNING id`,
        [roomId, user1.user.id]
      );
      await pool.query(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, thumbnail_path)
         VALUES ($1, 'images/test.jpg', 'test.jpg', 'image/jpeg', 12345, 'thumbnails/test.jpg')`,
        [msgRes.rows[0].id]
      );

      const res = await request(app)
        .get(`/api/rooms/${roomId}/media/gallery`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.media.length).toBe(1);
      expect(res.body.media[0].file_name).toBe('test.jpg');
    });

    it('should filter by tag', async () => {
      const pool = getTestPool();

      // Create 2 media messages
      const msg1 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type)
         VALUES ($1, $2, '', 'image') RETURNING id`,
        [roomId, user1.user.id]
      );
      await pool.query(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
         VALUES ($1, 'images/a.jpg', 'a.jpg', 'image/jpeg', 100)`,
        [msg1.rows[0].id]
      );

      const msg2 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type)
         VALUES ($1, $2, '', 'image') RETURNING id`,
        [roomId, user1.user.id]
      );
      await pool.query(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
         VALUES ($1, 'images/b.jpg', 'b.jpg', 'image/jpeg', 200)`,
        [msg2.rows[0].id]
      );

      // Tag only the first message
      const tagRes = await request(app)
        .post(`/api/rooms/${roomId}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '合宿' });

      await request(app)
        .post(`/api/messages/${msg1.rows[0].id}/tags`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ tag_id: tagRes.body.tag.id });

      // Filter by tag
      const res = await request(app)
        .get(`/api/rooms/${roomId}/media/gallery?tag=${tagRes.body.tag.id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.media.length).toBe(1);
      expect(res.body.media[0].file_name).toBe('a.jpg');
    });

    it('should support pagination', async () => {
      const pool = getTestPool();

      // Create 3 media messages
      for (let i = 0; i < 3; i++) {
        const msg = await pool.query(
          `INSERT INTO messages (room_id, sender_id, content, type)
           VALUES ($1, $2, '', 'image') RETURNING id`,
          [roomId, user1.user.id]
        );
        await pool.query(
          `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
           VALUES ($1, $2, $3, 'image/jpeg', 100)`,
          [msg.rows[0].id, `images/${i}.jpg`, `${i}.jpg`]
        );
      }

      const res = await request(app)
        .get(`/api/rooms/${roomId}/media/gallery?limit=2`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.media.length).toBe(2);
      expect(res.body.has_more).toBe(true);
    });
  });
});
