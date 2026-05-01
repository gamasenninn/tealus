const request = require('supertest');
const { app } = require('../../src/app');
const { getTestPool, setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');

describe('Auth API', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  // ============================================
  // POST /api/auth/register
  // ============================================
  describe('POST /api/auth/register', () => {
    it('should register a new user and return JWT', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'EMP001',
          display_name: '田中太郎',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.login_id).toBe('EMP001');
      expect(res.body.user.display_name).toBe('田中太郎');
      expect(res.body.user.password_hash).toBeUndefined(); // パスワードハッシュは返さない
    });

    it('should reject duplicate login_id', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'EMP001',
          display_name: '田中太郎',
          password: 'password123',
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'EMP001',
          display_name: '別の人',
          password: 'password456',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBeDefined();
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'EMP001',
          // display_name missing
          // password missing
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    // #211: First non-bot user should be auto-promoted to admin
    it('should auto-promote first non-bot user to admin role', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'FIRST_USER',
          display_name: '管理者',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('admin');
    });

    it('should create subsequent users with default user role', async () => {
      // First user → admin
      await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'FIRST_USER',
          display_name: '管理者',
          password: 'password123',
        });

      // Second user → user
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'SECOND_USER',
          display_name: '一般ユーザー',
          password: 'password456',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('user');
    });

    it('should auto-promote even if Bot users exist (only non-bot users counted)', async () => {
      const pool = getTestPool();
      // Insert a Bot user directly (simulating migration 006_bot_user.sql)
      await pool.query(
        `INSERT INTO users (login_id, display_name, password_hash, role, is_bot)
         VALUES ('BOT_TEST', 'Test Bot', 'dummy_hash', 'user', true)`
      );

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'FIRST_HUMAN',
          display_name: '管理者',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('admin');
    });
  });

  // ============================================
  // POST /api/auth/login
  // ============================================
  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Register a user first
      await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'EMP001',
          display_name: '田中太郎',
          password: 'password123',
        });
    });

    it('should login with correct credentials and return JWT', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          login_id: 'EMP001',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.login_id).toBe('EMP001');
      expect(res.body.user.display_name).toBe('田中太郎');
      expect(res.body.user.password_hash).toBeUndefined();
    });

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          login_id: 'EMP001',
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('should reject non-existent login_id', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          login_id: 'EMP999',
          password: 'password123',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  // ============================================
  // JWT Middleware — GET /api/auth/me
  // ============================================
  describe('GET /api/auth/me', () => {
    let token;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          login_id: 'EMP001',
          display_name: '田中太郎',
          password: 'password123',
        });
      token = res.body.token;
    });

    it('should return current user with valid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.login_id).toBe('EMP001');
      expect(res.body.user.display_name).toBe('田中太郎');
    });

    it('should reject request without token', async () => {
      const res = await request(app)
        .get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('should reject request with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalidtoken123');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });
});
