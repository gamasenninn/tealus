import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('Group Member Management', () => {
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let user1: Awaited<ReturnType<typeof createTestUser>>;
  let user2: Awaited<ReturnType<typeof createTestUser>>;
  let user3: Awaited<ReturnType<typeof createTestUser>>;
  let groupId: string;

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

      const sysMsg = msgs.body.messages.find((m: any) => m.type === 'system');
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

      const sysMsg = msgs.body.messages.find((m: any) => m.type === 'system');
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

      const sysMsg = msgs.body.messages.find((m: any) => m.type === 'system');
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
  // #391 1 対 1 ルームに紛れ込んだ 3 人目を外す
  //
  // ★ 入口は #390 で塞いだので、API では 3 人目を作れない。事故と同じ状態を DB から作る。
  // ★ direct には admin が居ない (作成時は 2 人とも 'member') ので、admin 判定は使えない。
  //   代わりに **joined_at が最古 = 正規の 2 人** を保護対象にする。
  // ============================================
  describe('DELETE /api/rooms/:id/members/:userId — direct room (#391)', () => {
    let directId: string;

    /** 事故と同じ状態: direct ルームに 3 人目が居る */
    const intrude = async (userId: string): Promise<void> => {
      await getTestPool().query(
        `INSERT INTO room_members (room_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', NOW() + interval '1 second')`,
        [directId, userId]
      );
    };

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ partner_id: user1.user.id });
      directId = res.body.room.id;
    });

    it('正規メンバーは 3 人目を外せる', async () => {
      await intrude(user2.user.id);

      const res = await request(app)
        .delete(`/api/rooms/${directId}/members/${user2.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);

      const { rows } = await getTestPool().query(
        'SELECT user_id FROM room_members WHERE room_id = $1',
        [directId]
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.user_id)).not.toContain(user2.user.id);
    });

    it('★ 正規メンバーどうしは外せない (2 人のままの direct では誰も外せない)', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${directId}/members/${user1.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(400);
      // ★ 理由まで固定する。requireGroup 時代も 400 だったので、状態だけ見ると
      //   「塞がっているから通った」のか「本来のメンバーを守ったから通った」のか区別できない。
      expect(res.body.error).toContain('本来のメンバー');

      const { rows } = await getTestPool().query(
        'SELECT user_id FROM room_members WHERE room_id = $1',
        [directId]
      );
      expect(rows).toHaveLength(2);
    });

    it('★ 3 人目が居ても 正規メンバーは外せない (侵入者が本人を追い出せない)', async () => {
      await intrude(user2.user.id);

      const res = await request(app)
        .delete(`/api/rooms/${directId}/members/${user1.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('本来のメンバー');
    });

    it('★ 3 人目は誰も外せない', async () => {
      await intrude(user2.user.id);

      const res = await request(app)
        .delete(`/api/rooms/${directId}/members/${user1.user.id}`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(403);
    });

    it('外したことがシステムメッセージに残る', async () => {
      await intrude(user2.user.id);
      await request(app)
        .delete(`/api/rooms/${directId}/members/${user2.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      const msgs = await request(app)
        .get(`/api/rooms/${directId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`);

      const sysMsg = msgs.body.messages.find((m: { type: string }) => m.type === 'system');
      expect(sysMsg).toBeDefined();
      expect(sysMsg.content).toContain('五条悟');
    });

    it('ルームの非メンバーは操作できない', async () => {
      await intrude(user2.user.id);

      const res = await request(app)
        .delete(`/api/rooms/${directId}/members/${user2.user.id}`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
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

      const sysMsg = msgs.body.messages.find((m: any) => m.type === 'system');
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
