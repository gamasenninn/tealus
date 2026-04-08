const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Webhook API', () => {
  let admin, user, roomId;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ employee_id: 'ADMIN01', display_name: '管理者' });
    user = await createTestUser({ employee_id: 'EMP001', display_name: '一般ユーザー' });

    // adminにadmin権限を付与
    const pool = getTestPool();
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);

    // テスト用ルーム作成
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'テストルーム', member_ids: [user.user.id] });
    roomId = roomRes.body.room.id;
  });

  // ============================================
  // POST /api/admin/webhooks
  // ============================================
  describe('POST /api/admin/webhooks', () => {
    it('管理者がWebhookを登録できる', async () => {
      const res = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          url: 'https://example.com/webhook',
          events: ['message.created'],
        });

      expect(res.status).toBe(201);
      expect(res.body.webhook.url).toBe('https://example.com/webhook');
      expect(res.body.webhook.events).toEqual(['message.created']);
      expect(res.body.webhook.is_active).toBe(true);
    });

    it('ルーム指定でWebhookを登録できる', async () => {
      const res = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          url: 'https://example.com/webhook',
          room_id: roomId,
          events: ['message.created'],
        });

      expect(res.status).toBe(201);
      expect(res.body.webhook.room_id).toBe(roomId);
    });

    it('secretを指定してWebhookを登録できる', async () => {
      const res = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          url: 'https://example.com/webhook',
          secret: 'my-secret-key',
          events: ['message.created'],
        });

      expect(res.status).toBe(201);
      // secretはレスポンスに含まれない（セキュリティ）
      expect(res.body.webhook.secret).toBeUndefined();
    });

    it('一般ユーザーは登録できない', async () => {
      const res = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          url: 'https://example.com/webhook',
          events: ['message.created'],
        });

      expect(res.status).toBe(403);
    });

    it('URLなしはエラー', async () => {
      const res = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ events: ['message.created'] });

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // GET /api/admin/webhooks
  // ============================================
  describe('GET /api/admin/webhooks', () => {
    it('Webhook一覧を取得できる', async () => {
      // 2件登録
      await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ url: 'https://example.com/hook1', events: ['message.created'] });
      await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ url: 'https://example.com/hook2', events: ['message.created', 'message.deleted'] });

      const res = await request(app)
        .get('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.webhooks).toHaveLength(2);
    });

    it('一般ユーザーは取得できない', async () => {
      const res = await request(app)
        .get('/api/admin/webhooks')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // PUT /api/admin/webhooks/:id
  // ============================================
  describe('PUT /api/admin/webhooks/:id', () => {
    it('Webhookを更新できる', async () => {
      const createRes = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ url: 'https://example.com/hook', events: ['message.created'] });

      const webhookId = createRes.body.webhook.id;

      const res = await request(app)
        .put(`/api/admin/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ url: 'https://example.com/updated', is_active: false });

      expect(res.status).toBe(200);
      expect(res.body.webhook.url).toBe('https://example.com/updated');
      expect(res.body.webhook.is_active).toBe(false);
    });
  });

  // ============================================
  // DELETE /api/admin/webhooks/:id
  // ============================================
  describe('DELETE /api/admin/webhooks/:id', () => {
    it('Webhookを削除できる', async () => {
      const createRes = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ url: 'https://example.com/hook', events: ['message.created'] });

      const webhookId = createRes.body.webhook.id;

      const res = await request(app)
        .delete(`/api/admin/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);

      // 削除確認
      const listRes = await request(app)
        .get('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(listRes.body.webhooks).toHaveLength(0);
    });
  });

  // ============================================
  // POST /api/admin/webhooks/:id/test
  // ============================================
  describe('POST /api/admin/webhooks/:id/test', () => {
    it('テスト送信のエンドポイントが存在する', async () => {
      const createRes = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ url: 'https://httpbin.org/post', events: ['message.created'] });

      const webhookId = createRes.body.webhook.id;

      const res = await request(app)
        .post(`/api/admin/webhooks/${webhookId}/test`)
        .set('Authorization', `Bearer ${admin.token}`);

      // テスト送信は外部HTTPなので成否は問わず、エンドポイント自体が存在することを確認
      expect([200, 502]).toContain(res.status);
    });
  });
});
