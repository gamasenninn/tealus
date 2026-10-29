import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const fixturesDir = path.join(import.meta.dirname, '../fixtures');

async function ensureIconFixture() {
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  const iconPath = path.join(fixturesDir, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 180, b: 160 } }
    }).png().toFile(iconPath);
  }
  return iconPath;
}

describe('Room Edit API', () => {
  let admin: TestUser, user1: TestUser, groupId: string, iconPath: string;

  beforeAll(async () => {
    await setupTestDb();
    iconPath = await ensureIconFixture();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADMIN01', display_name: '田中太郎' });
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '鈴木花子' });

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'テストグループ', member_ids: [user1.user.id] });
    groupId = res.body.room.id;
  });

  // ★ 2026-10-29 改善ループ 22 回目: 種類の検査 (requireGroup) がメンバーの検査より先で、メンバーでない人にも
  //   「その部屋があるか (404)」「1 対 1 か (400)」が分かった。メンバーでなければ種類によらず 403
  describe('メンバーでない人には、部屋の種類を明かさない', () => {
    it('★ 1 対 1 の部屋でも、無い部屋でも 403', async () => {
      const outsider = await createTestUser({ login_id: 'EMP999', display_name: '部外者' });
      const dm = await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${admin.token}`).send({ partner_id: user1.user.id });
      const directId = dm.body.room.id;
      for (const id of [directId, '00000000-0000-4000-8000-000000000000']) {
        const put = await request(app).put(`/api/rooms/${id}`).set('Authorization', `Bearer ${outsider.token}`).send({ name: 'x' });
        expect(put.status).toBe(403);
        const add = await request(app).post(`/api/rooms/${id}/members`).set('Authorization', `Bearer ${outsider.token}`).send({ user_ids: [outsider.user.id] });
        expect(add.status).toBe(403);
      }
    });
  });

  describe('PUT /api/rooms/:id', () => {
    it('should update group name (admin only)', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: '新しいグループ名' });

      expect(res.status).toBe(200);
      expect(res.body.room.name).toBe('新しいグループ名');
    });

    // ★ 改善ループ 18 回目: 列は VARCHAR(100) なのに長さを見ておらず、DB の例外で 500 になっていた
    it('★ グループ名は 100 字まで (作るときも変えるときも 400)', async () => {
      const long = 'あ'.repeat(101);
      const put = await request(app).put(`/api/rooms/${groupId}`).set('Authorization', `Bearer ${admin.token}`).send({ name: long });
      expect(put.status).toBe(400);
      expect(put.body.error).toMatch(/100/);
      const post = await request(app).post('/api/rooms').set('Authorization', `Bearer ${admin.token}`).send({ name: long, member_ids: [user1.user.id] });
      expect(post.status).toBe(400);
      const ok = await request(app).put(`/api/rooms/${groupId}`).set('Authorization', `Bearer ${admin.token}`).send({ name: 'あ'.repeat(100) });
      expect(ok.status).toBe(200);
    });

    it('★ アイコンが 5MB を超えたら 413 (500 にしない)', async () => {
      const res = await request(app).post(`/api/rooms/${groupId}/icon`).set('Authorization', `Bearer ${admin.token}`)
        .attach('icon', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' });
      expect(res.status).toBe(413);
    });

    it('should reject by non-admin', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '不正な変更' });

      expect(res.status).toBe(403);
    });

    /**
     * #418 会話モードの道具を「既定で全許可 + 外す」に変える (docs/08 §12.17)。
     *
     * ★ 外す道具は **会話モードを開く判定と同じ門 (requireRoomAdmin)** に置く。
     *   room_settings.json 側の PUT は認証のみで、誰でも任意のルームを書き換えられるため
     *   (docs/08 §12.11 が 028 の列を DB に置いた理由と同じ)。
     */
    it('★ admin は 会話モードで外す道具を更新できる (#418)', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ voice_conversation_denied_tools: ['execute_sql', 'tavily_search'] });

      expect(res.status).toBe(200);
      expect(res.body.room.voice_conversation_denied_tools).toEqual(['execute_sql', 'tavily_search']);
    });

    it('★ 非 admin は 外す道具を更新できない (声から道具の門を開けられない)', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ voice_conversation_denied_tools: [] });

      expect(res.status).toBe(403);
    });

    it('★ 既定は空 (何もしなければ 1 つも外れない)', async () => {
      const res = await request(app)
        .get(`/api/rooms/${groupId}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.room.voice_conversation_denied_tools).toEqual([]);
    });

    it('should reject on direct room', async () => {
      const directRes = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ partner_id: user1.user.id });

      const res = await request(app)
        .put(`/api/rooms/${directRes.body.room.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'test' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/rooms/:id/icon', () => {
    it('should upload group icon (admin only)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${groupId}/icon`)
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('icon', iconPath);

      expect(res.status).toBe(200);
      expect(res.body.room.icon_url).toContain('icons/');
    });

    it('should reject by non-admin', async () => {
      const res = await request(app)
        .post(`/api/rooms/${groupId}/icon`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('icon', iconPath);

      expect(res.status).toBe(403);
    });
  });
});
