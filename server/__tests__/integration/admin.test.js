const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Admin API', () => {
  let admin, user1;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    // Create users via register API
    admin = await createTestUser({ login_id: 'ADMIN001', display_name: '管理者' });
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });

    // Promote admin user directly in DB
    const pool = getTestPool();
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
  });

  // ============================================
  // Authorization
  // ============================================
  describe('Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${user1.token}`);
      expect(res.status).toBe(403);
    });

    it('should allow admin users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
    });
  });

  // ============================================
  // GET /api/admin/users
  // ============================================
  describe('GET /api/admin/users', () => {
    it('should return all users with role info', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(2);
      expect(res.body.users[0]).toHaveProperty('role');
      expect(res.body.users[0]).not.toHaveProperty('password_hash');
    });
  });

  // ============================================
  // POST /api/admin/users
  // ============================================
  describe('POST /api/admin/users', () => {
    it('should create a new user', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ login_id: 'EMP099', display_name: '新規ユーザー', password: '1234' });

      expect(res.status).toBe(201);
      expect(res.body.user.login_id).toBe('EMP099');
      expect(res.body.user.display_name).toBe('新規ユーザー');
      expect(res.body.user.role).toBe('user');
    });

    it('should reject duplicate login_id', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ login_id: 'EMP001', display_name: '重複', password: '1234' });

      expect(res.status).toBe(409);
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ login_id: 'EMP100' });

      expect(res.status).toBe(400);
    });

    it('should allow creating admin user', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ login_id: 'ADMIN002', display_name: '管理者2', password: '1234', role: 'admin' });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('admin');
    });
  });

  // ============================================
  // PUT /api/admin/users/:id
  // ============================================
  describe('PUT /api/admin/users/:id', () => {
    it('should update display_name', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${user1.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ display_name: '田中次郎' });

      expect(res.status).toBe(200);
      expect(res.body.user.display_name).toBe('田中次郎');
    });

    it('should update password', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${user1.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ password: 'newpass' });

      expect(res.status).toBe(200);

      // Verify new password works
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ login_id: 'EMP001', password: 'newpass' });
      expect(loginRes.status).toBe(200);
    });

    it('should update role', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${user1.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');
    });

    it('should return 404 for non-existent user', async () => {
      const res = await request(app)
        .put('/api/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ display_name: 'test' });

      expect(res.status).toBe(404);
    });
  });

  // ============================================
  // PATCH /api/admin/users/:id/status
  // ============================================
  describe('PATCH /api/admin/users/:id/status', () => {
    it('should deactivate a user', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${user1.user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ is_active: false });

      expect(res.status).toBe(200);
      expect(res.body.user.is_active).toBe(false);
    });

    it('should reactivate a user', async () => {
      // First deactivate
      await request(app)
        .patch(`/api/admin/users/${user1.user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ is_active: false });

      // Then reactivate
      const res = await request(app)
        .patch(`/api/admin/users/${user1.user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ is_active: true });

      expect(res.status).toBe(200);
      expect(res.body.user.is_active).toBe(true);
    });

    it('should prevent deactivated user from logging in', async () => {
      await request(app)
        .patch(`/api/admin/users/${user1.user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ is_active: false });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ login_id: 'EMP001', password: 'password123' });

      expect(loginRes.status).toBe(401);
    });
  });
});
