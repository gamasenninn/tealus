const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Push Subscription API', () => {
  let user1;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ employee_id: 'EMP001', display_name: '田中太郎' });
  });

  describe('POST /api/push/subscribe', () => {
    it('should register a push subscription', async () => {
      const res = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({
          endpoint: 'https://fcm.googleapis.com/fcm/send/test123',
          p256dh_key: 'test_p256dh_key',
          auth_key: 'test_auth_key',
          device_name: 'iPhoneのSafari',
        });

      expect(res.status).toBe(201);
      expect(res.body.subscription).toBeDefined();
      expect(res.body.subscription.endpoint).toBe('https://fcm.googleapis.com/fcm/send/test123');
    });

    it('should not duplicate same endpoint for same user', async () => {
      const subData = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test123',
        p256dh_key: 'test_p256dh_key',
        auth_key: 'test_auth_key',
      };

      await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${user1.token}`)
        .send(subData);

      const res = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ ...subData, p256dh_key: 'updated_key' });

      expect(res.status).toBe(200);

      // Check only one record exists
      const pool = getTestPool();
      const count = await pool.query(
        'SELECT COUNT(*) FROM push_subscriptions WHERE user_id = $1',
        [user1.user.id]
      );
      expect(parseInt(count.rows[0].count)).toBe(1);
    });

    it('should reject without required fields', async () => {
      const res = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ endpoint: 'https://example.com' });

      expect(res.status).toBe(400);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/push/subscribe')
        .send({
          endpoint: 'https://example.com',
          p256dh_key: 'key',
          auth_key: 'auth',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/push/subscribe', () => {
    it('should remove a push subscription', async () => {
      const endpoint = 'https://fcm.googleapis.com/fcm/send/test123';

      await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({
          endpoint,
          p256dh_key: 'key',
          auth_key: 'auth',
        });

      const res = await request(app)
        .delete('/api/push/subscribe')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ endpoint });

      expect(res.status).toBe(200);

      // Verify it's gone
      const pool = getTestPool();
      const count = await pool.query(
        'SELECT COUNT(*) FROM push_subscriptions WHERE user_id = $1',
        [user1.user.id]
      );
      expect(parseInt(count.rows[0].count)).toBe(0);
    });
  });
});
