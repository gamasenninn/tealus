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
          employee_id: 'EMP001',
          display_name: '田中太郎',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.employee_id).toBe('EMP001');
      expect(res.body.user.display_name).toBe('田中太郎');
      expect(res.body.user.password_hash).toBeUndefined(); // パスワードハッシュは返さない
    });

    it('should reject duplicate employee_id', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          employee_id: 'EMP001',
          display_name: '田中太郎',
          password: 'password123',
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          employee_id: 'EMP001',
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
          employee_id: 'EMP001',
          // display_name missing
          // password missing
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
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
          employee_id: 'EMP001',
          display_name: '田中太郎',
          password: 'password123',
        });
    });

    it('should login with correct credentials and return JWT', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          employee_id: 'EMP001',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.employee_id).toBe('EMP001');
      expect(res.body.user.display_name).toBe('田中太郎');
      expect(res.body.user.password_hash).toBeUndefined();
    });

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          employee_id: 'EMP001',
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('should reject non-existent employee_id', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          employee_id: 'EMP999',
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
          employee_id: 'EMP001',
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
      expect(res.body.user.employee_id).toBe('EMP001');
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
