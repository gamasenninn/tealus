const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Rooms API', () => {
  let user1, user2, user3;

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
  });

  // ============================================
  // POST /api/rooms (group)
  // ============================================
  describe('POST /api/rooms', () => {
    it('should create a group room', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({
          name: '開発チーム',
          member_ids: [user2.user.id, user3.user.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.room.type).toBe('group');
      expect(res.body.room.name).toBe('開発チーム');
      expect(res.body.members).toHaveLength(3); // creator + 2 members
    });

    it('should set creator as admin', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({
          name: '開発チーム',
          member_ids: [user2.user.id],
        });

      const creator = res.body.members.find(m => m.user_id === user1.user.id);
      expect(creator.role).toBe('admin');
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ name: '開発チーム', member_ids: [user2.user.id] });

      expect(res.status).toBe(401);
    });

    it('should reject without name', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ member_ids: [user2.user.id] });

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // POST /api/rooms/direct
  // ============================================
  describe('POST /api/rooms/direct', () => {
    it('should create a direct room between two users', async () => {
      const res = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      expect(res.status).toBe(201);
      expect(res.body.room.type).toBe('direct');
      expect(res.body.members).toHaveLength(2);
    });

    it('should return existing room if already created', async () => {
      const res1 = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      const res2 = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      expect(res2.status).toBe(200);
      expect(res2.body.room.id).toBe(res1.body.room.id);
    });

    it('should return same room regardless of who initiates', async () => {
      const res1 = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      const res2 = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ partner_id: user1.user.id });

      expect(res2.body.room.id).toBe(res1.body.room.id);
    });

    it('should reject without partner_id', async () => {
      const res = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // GET /api/rooms
  // ============================================
  describe('GET /api/rooms', () => {
    it('should return rooms the user belongs to', async () => {
      // Create a room with user1 and user2
      await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      // Create a room with user1 and user3
      await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'テストグループ', member_ids: [user3.user.id] });

      const res = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.rooms).toHaveLength(2);
    });

    it('should not return rooms the user does not belong to', async () => {
      // Create a room between user1 and user2
      await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      // user3 should not see it
      const res = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(200);
      expect(res.body.rooms).toHaveLength(0);
    });
  });

  // ============================================
  // GET /api/rooms/:id
  // ============================================
  describe('GET /api/rooms/:id', () => {
    it('should return room details with members', async () => {
      const createRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '開発チーム', member_ids: [user2.user.id, user3.user.id] });

      const roomId = createRes.body.room.id;

      const res = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.room.id).toBe(roomId);
      expect(res.body.room.name).toBe('開発チーム');
      expect(res.body.members).toHaveLength(3);
    });

    it('should reject access from non-member', async () => {
      const createRes = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      const roomId = createRes.body.room.id;

      const res = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // DELETE /api/rooms/:id
  // ============================================
  describe('DELETE /api/rooms/:id', () => {
    it('should delete a solo bot-only room (creator + only member)', async () => {
      const createRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'solo room' });

      const roomId = createRes.body.room.id;

      const res = await request(app)
        .delete(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.room_id).toBe(roomId);

      // Verify the room is gone (no longer appears in list)
      const listRes = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`);
      expect(listRes.status).toBe(200);
      const ids = listRes.body.rooms.map(r => r.id);
      expect(ids).not.toContain(roomId);
    });

    it('should reject deletion when other members exist (409)', async () => {
      const createRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'group with members', member_ids: [user2.user.id] });

      const roomId = createRes.body.room.id;

      const res = await request(app)
        .delete(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('他のメンバー');
    });

    it('should reject deletion by non-creator (403)', async () => {
      // user1 creates with user2 as member
      const createRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'shared', member_ids: [user2.user.id] });

      const roomId = createRes.body.room.id;

      // user2 (member but not creator) tries to delete
      const res = await request(app)
        .delete(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('作成した本人');
    });

    it('should reject deletion by non-member (403)', async () => {
      const createRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'private' });

      const roomId = createRes.body.room.id;

      // user3 (not a member) tries to delete
      const res = await request(app)
        .delete(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent room', async () => {
      const res = await request(app)
        .delete('/api/rooms/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(404);
    });

    it('should reject deletion of direct room (group only)', async () => {
      const createRes = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ partner_id: user2.user.id });

      const roomId = createRes.body.room.id;

      const res = await request(app)
        .delete(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('グループのみ');
    });

    it('should reject without auth', async () => {
      const createRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'private' });

      const roomId = createRes.body.room.id;

      const res = await request(app).delete(`/api/rooms/${roomId}`);
      expect(res.status).toBe(401);
    });
  });
});
