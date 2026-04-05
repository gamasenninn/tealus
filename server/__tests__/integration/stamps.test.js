const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Stamps API', () => {
  let user1, user2, admin;

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
    admin = await createTestUser({ employee_id: 'ADM001', display_name: '管理者' });

    const pool = getTestPool();
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
  });

  // ============================================
  // GET /api/stamps/packs — パック一覧
  // ============================================
  describe('GET /api/stamps/packs', () => {
    it('should return empty list initially', async () => {
      const res = await request(app)
        .get('/api/stamps/packs')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.packs).toEqual([]);
    });

    it('should return packs with creator info', async () => {
      const pool = getTestPool();
      await pool.query(
        `INSERT INTO stamp_packs (id, name, prompt, created_by, thumbnail_path)
         VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'テストパック', 'test prompt', $1, 'stamps/test/00.png')`,
        [user1.user.id]
      );

      const res = await request(app)
        .get('/api/stamps/packs')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.packs.length).toBe(1);
      expect(res.body.packs[0].name).toBe('テストパック');
      expect(res.body.packs[0].creator_name).toBe('田中太郎');
    });
  });

  // ============================================
  // GET /api/stamps/packs/:id — パック詳細
  // ============================================
  describe('GET /api/stamps/packs/:id', () => {
    it('should return pack with stamps', async () => {
      const pool = getTestPool();
      const packId = 'aaaaaaaa-0000-0000-0000-000000000002';
      await pool.query(
        `INSERT INTO stamp_packs (id, name, prompt, created_by)
         VALUES ($1, 'テスト', 'prompt', $2)`,
        [packId, user1.user.id]
      );
      await pool.query(
        `INSERT INTO stamps (pack_id, file_path, label, sort_order)
         VALUES ($1, 'stamps/test/00.png', '了解です', 0),
                ($1, 'stamps/test/01.png', 'おはよう', 1)`,
        [packId]
      );

      const res = await request(app)
        .get(`/api/stamps/packs/${packId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.pack.name).toBe('テスト');
      expect(res.body.stamps.length).toBe(2);
      expect(res.body.stamps[0].label).toBe('了解です');
    });

    it('should return 404 for unknown pack', async () => {
      const res = await request(app)
        .get('/api/stamps/packs/aaaaaaaa-0000-0000-0000-999999999999')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(404);
    });
  });

  // ============================================
  // DELETE /api/stamps/packs/:id — パック削除
  // ============================================
  describe('DELETE /api/stamps/packs/:id', () => {
    let packId;

    beforeEach(async () => {
      const pool = getTestPool();
      packId = 'aaaaaaaa-0000-0000-0000-000000000003';
      await pool.query(
        `INSERT INTO stamp_packs (id, name, prompt, created_by)
         VALUES ($1, '削除テスト', 'prompt', $2)`,
        [packId, user1.user.id]
      );
    });

    it('should allow creator to delete', async () => {
      const res = await request(app)
        .delete(`/api/stamps/packs/${packId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow admin to delete', async () => {
      const res = await request(app)
        .delete(`/api/stamps/packs/${packId}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
    });

    it('should reject non-creator non-admin', async () => {
      const res = await request(app)
        .delete(`/api/stamps/packs/${packId}`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // POST /api/stamps/generate — 生成（バリデーション）
  // ============================================
  describe('POST /api/stamps/generate', () => {
    it('should reject empty prompt', async () => {
      const res = await request(app)
        .post('/api/stamps/generate')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ prompt: '' });

      expect(res.status).toBe(400);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/stamps/generate')
        .send({ prompt: 'テスト' });

      expect(res.status).toBe(401);
    });

    it('should enforce daily limit', async () => {
      const pool = getTestPool();
      // Insert 3 packs created today
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO stamp_packs (name, prompt, created_by)
           VALUES ($1, 'test', $2)`,
          [`pack${i}`, user1.user.id]
        );
      }

      const res = await request(app)
        .post('/api/stamps/generate')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ prompt: 'テスト' });

      expect(res.status).toBe(429);
    });

    it('should not enforce daily limit for admin', async () => {
      const pool = getTestPool();
      // Insert 3 packs created today by admin
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO stamp_packs (name, prompt, created_by)
           VALUES ($1, 'test', $2)`,
          [`pack${i}`, admin.user.id]
        );
      }

      // Admin should get past limit check (will fail at AI call, but not 429)
      const res = await request(app)
        .post('/api/stamps/generate')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ prompt: 'テスト' });

      // Will fail because no API key, but NOT 429
      expect(res.status).not.toBe(429);
    });
  });

  // ============================================
  // Stamp message type
  // ============================================
  describe('Stamp messages', () => {
    it('should send a stamp message', async () => {
      const pool = getTestPool();
      const packId = 'aaaaaaaa-0000-0000-0000-000000000004';
      await pool.query(
        `INSERT INTO stamp_packs (id, name, prompt, created_by)
         VALUES ($1, 'テスト', 'prompt', $2)`,
        [packId, user1.user.id]
      );
      const stampRes = await pool.query(
        `INSERT INTO stamps (id, pack_id, file_path, label, sort_order)
         VALUES ('bbbbbbbb-0000-0000-0000-000000000001', $1, 'stamps/test/00.png', '了解です', 0)
         RETURNING id`,
        [packId]
      );
      const stampId = stampRes.rows[0].id;

      // Create a room
      const roomRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'テストルーム', member_ids: [user2.user.id] });
      const roomId = roomRes.body.room.id;

      // Send stamp message
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: stampId, type: 'stamp' });

      expect(msgRes.status).toBe(201);
      expect(msgRes.body.message.type).toBe('stamp');
      expect(msgRes.body.message.content).toBe(stampId);
    });
  });
});
