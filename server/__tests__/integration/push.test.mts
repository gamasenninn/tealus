import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../src/middleware/auth.mts';

describe('Push Subscription API', () => {
  let user1: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
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

    /**
     * 改善ループ 2 回目 (10-15) の 4.: ログインの期限が切れてログアウトするとき、通知の登録を外す呼び出しが
     * 期限切れのトークンで 401 になり、必ず失敗していた (登録が残り、次に送ったときの 410 でやっと消えた)。
     * ★ この口だけは、署名が正しければ期限切れでも受け付ける (できるのは自分の登録を外すことだけ)
     */
    const endpoint = 'https://fcm.googleapis.com/fcm/send/expired-test';
    async function subscribe(token: string) {
      await request(app).post('/api/push/subscribe').set('Authorization', `Bearer ${token}`)
        .send({ endpoint, p256dh_key: 'key', auth_key: 'auth' });
    }
    async function remaining(userId: string) {
      const r = await getTestPool().query('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = $1', [userId]);
      return parseInt(r.rows[0].count);
    }
    const expiredTokenFor = (u: { id: string; login_id: string }) =>
      jwt.sign({ id: u.id, login_id: u.login_id, exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET);

    it('★★ 期限切れのトークンでも、自分の登録は外せる', async () => {
      await subscribe(user1.token);
      const res = await request(app).delete('/api/push/subscribe')
        .set('Authorization', `Bearer ${expiredTokenFor(user1.user)}`).send({ endpoint });
      expect(res.status).toBe(200);
      expect(await remaining(user1.user.id)).toBe(0);
    });

    it('★ 署名が違うトークンは断る', async () => {
      await subscribe(user1.token);
      const forged = jwt.sign({ id: user1.user.id, login_id: 'x' }, 'not-the-secret');
      const res = await request(app).delete('/api/push/subscribe')
        .set('Authorization', `Bearer ${forged}`).send({ endpoint });
      expect(res.status).toBe(401);
      expect(await remaining(user1.user.id)).toBe(1);
    });

    it('★ 期限切れのトークンで、他人の登録は外せない', async () => {
      await subscribe(user1.token);
      const user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
      const res = await request(app).delete('/api/push/subscribe')
        .set('Authorization', `Bearer ${expiredTokenFor(user2.user)}`).send({ endpoint });
      expect(res.status).toBe(200);   // 自分の登録が無いだけ
      expect(await remaining(user1.user.id)).toBe(1);
    });

    it('★★ 期限切れのトークンは、登録 (POST) には使えない (今までどおり 401)', async () => {
      const res = await request(app).post('/api/push/subscribe')
        .set('Authorization', `Bearer ${expiredTokenFor(user1.user)}`)
        .send({ endpoint, p256dh_key: 'key', auth_key: 'auth' });
      expect(res.status).toBe(401);
    });
  });
});
