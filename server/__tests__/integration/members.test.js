const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Group Member Management', () => {
  let admin, user1, user2, user3, groupId;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADMIN01', display_name: '田中太郎' });
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '鈴木花子' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '五条悟' });
    user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });

    // Create group (admin is group admin, user1 is member)
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'テストグループ', member_ids: [user1.user.id] });
    groupId = res.body.room.id;
  });

  // ============================================
  // POST /api/rooms/:id/members — メンバー追加
  // ============================================
  describe('POST /api/rooms/:id/members', () => {
    it('should add a member (by any member)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${groupId}/members`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ user_id: user2.user.id });

      expect(res.status).toBe(200);
      expect(res.body.member).toBeDefined();
      expect(res.body.member.user_id).toBe(user2.user.id);
    });

    it('should create a system message when adding', async () => {
      await request(app)
        .post(`/api/rooms/${groupId}/members`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ user_id: user2.user.id });

      const msgs = await request(app)
        .get(`/api/rooms/${groupId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`);

      const sysMsg = msgs.body.messages.find(m => m.type === 'system');
      expect(sysMsg).toBeDefined();
      expect(sysMsg.content).toContain('五条悟');
    });

    it('should reject adding existing member', async () => {
      const res = await request(app)
        .post(`/api/rooms/${groupId}/members`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ user_id: user1.user.id });

      expect(res.status).toBe(409);
    });

    it('should reject on direct room', async () => {
      const directRes = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ partner_id: user2.user.id });

      const res = await request(app)
        .post(`/api/rooms/${directRes.body.room.id}/members`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ user_id: user3.user.id });

      expect(res.status).toBe(400);
    });

    it('should reject by non-member', async () => {
      const res = await request(app)
        .post(`/api/rooms/${groupId}/members`)
        .set('Authorization', `Bearer ${user3.token}`)
        .send({ user_id: user2.user.id });

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // DELETE /api/rooms/:id/members/me — 自分が退会
  // ============================================
  describe('DELETE /api/rooms/:id/members/me', () => {
    it('should allow member to leave', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${groupId}/members/me`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
    });

    it('should create a system message when leaving', async () => {
      await request(app)
        .delete(`/api/rooms/${groupId}/members/me`)
        .set('Authorization', `Bearer ${user1.token}`);

      const msgs = await request(app)
        .get(`/api/rooms/${groupId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`);

      const sysMsg = msgs.body.messages.find(m => m.type === 'system');
      expect(sysMsg).toBeDefined();
      expect(sysMsg.content).toContain('鈴木花子');
      expect(sysMsg.content).toContain('退会');
    });

    it('should reject last group admin from leaving', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${groupId}/members/me`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('グループ管理者');
    });

    it('should allow admin to leave if another admin exists', async () => {
      // Promote user1 to admin
      await request(app)
        .put(`/api/rooms/${groupId}/members/${user1.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'admin' });

      const res = await request(app)
        .delete(`/api/rooms/${groupId}/members/me`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
    });
  });

  // ============================================
  // DELETE /api/rooms/:id/members/:userId — メンバー除外
  // ============================================
  describe('DELETE /api/rooms/:id/members/:userId', () => {
    it('should allow group admin to kick member', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${groupId}/members/${user1.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
    });

    it('should create a system message when kicking', async () => {
      await request(app)
        .delete(`/api/rooms/${groupId}/members/${user1.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      const msgs = await request(app)
        .get(`/api/rooms/${groupId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`);

      const sysMsg = msgs.body.messages.find(m => m.type === 'system');
      expect(sysMsg).toBeDefined();
      expect(sysMsg.content).toContain('鈴木花子');
      expect(sysMsg.content).toContain('退会させました');
    });

    it('should reject kick by non-admin', async () => {
      // Add user2 first
      await request(app)
        .post(`/api/rooms/${groupId}/members`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ user_id: user2.user.id });

      const res = await request(app)
        .delete(`/api/rooms/${groupId}/members/${user2.user.id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(403);
    });

    it('should reject self-kick', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${groupId}/members/${admin.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // PUT /api/rooms/:id/members/:userId/role — グループ管理者変更
  // ============================================
  describe('PUT /api/rooms/:id/members/:userId/role', () => {
    it('should promote member to admin', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}/members/${user1.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.member.role).toBe('admin');
    });

    it('should create a system message when promoting', async () => {
      await request(app)
        .put(`/api/rooms/${groupId}/members/${user1.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'admin' });

      const msgs = await request(app)
        .get(`/api/rooms/${groupId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`);

      const sysMsg = msgs.body.messages.find(m => m.type === 'system');
      expect(sysMsg).toBeDefined();
      expect(sysMsg.content).toContain('鈴木花子');
      expect(sysMsg.content).toContain('グループ管理者');
    });

    it('should demote admin to member', async () => {
      // Promote first
      await request(app)
        .put(`/api/rooms/${groupId}/members/${user1.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'admin' });

      const res = await request(app)
        .put(`/api/rooms/${groupId}/members/${user1.user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'member' });

      expect(res.status).toBe(200);
      expect(res.body.member.role).toBe('member');
    });

    it('should reject by non-admin', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}/members/${admin.user.id}/role`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(403);
    });
  });
});
