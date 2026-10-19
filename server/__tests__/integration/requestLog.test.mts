/**
 * 改善ループ 9 回目の B・C — 本体の要求の記録に「誰が」を残す。
 *
 * ★ C: 断られた要求 (401/403/429) は「方法・URL・状態」しか残らず、期限切れの端末か・機械か・外からの試しかを後から言えなかった
 * ★ B: メンバーの追加・外す・役割、部屋の設定、利用者の変更は、成功しても「誰が変えたか」がどこにも残らなかった
 * ★ 本文の値は残さない (パスワード・本文が入りうる)。残すのは欄の名前だけ
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { logger } from '../../src/utils/logger.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const lines = (spy: ReturnType<typeof jest.spyOn>, prefix: string): string[] =>
  (spy.mock.calls as unknown[][]).map((c) => String(c[0])).filter((s) => s.startsWith(prefix));

describe('要求の記録に「誰が」を残す', () => {
  let warn: ReturnType<typeof jest.spyOn>;
  let info: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
  });
  afterEach(() => { warn.mockRestore(); info.mockRestore(); });

  // 応答を返したあとに書くので、1 拍待つ
  const settle = () => new Promise((r) => setImmediate(r));

  describe('C: 断られた要求', () => {
    it('401 は理由の分かる行を残す (誰か分からないので user=-、端末の ua を添える)', async () => {
      const res = await request(app).get('/api/rooms').set('User-Agent', 'TestPhone/1.0');
      expect(res.status).toBe(401);
      await settle();
      const l = lines(warn, '[http-denied]');
      expect(l).toHaveLength(1);
      expect(l[0]).toMatch(/^\[http-denied\] 401 GET \/api\/rooms /);
      expect(l[0]).toMatch(/user=- /);
      expect(l[0]).toMatch(/ip=\S+/);
      expect(l[0]).toMatch(/ua=TestPhone\/1\.0/);
    });

    it('403 はログイン済みの利用者を残す', async () => {
      const u: TestUser = await createTestUser();
      const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${u.token}`);
      expect(res.status).toBe(403);
      await settle();
      const l = lines(warn, '[http-denied]');
      expect(l).toHaveLength(1);
      expect(l[0]).toMatch(/^\[http-denied\] 403 GET \/api\/admin\/users /);
      expect(l[0]).toContain(`user=${u.user.id.slice(0, 8)}`);
    });

    it('問い合わせ (?…) は残さない (鍵などが乗ることがある)', async () => {
      await request(app).get('/api/rooms?token=secret-value');
      await settle();
      const l = lines(warn, '[http-denied]');
      expect(l).toHaveLength(1);
      expect(l[0]).not.toContain('secret-value');
    });

    it('通った要求には残さない', async () => {
      const u: TestUser = await createTestUser();
      const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${u.token}`);
      expect(res.status).toBe(200);
      await settle();
      expect(lines(warn, '[http-denied]')).toHaveLength(0);
    });
  });

  describe('B: 変更の記録', () => {
    it('部屋の設定を変えたら、誰が・どの部屋の・どの欄を変えたかを残す (値は残さない)', async () => {
      const u: TestUser = await createTestUser();
      const pool = getTestPool();
      const room = await pool.query<{ id: string }>(
        "INSERT INTO rooms (name, type, created_by) VALUES ('設定の試し', 'group', $1) RETURNING id", [u.user.id]);
      const roomId = room.rows[0].id;
      await pool.query("INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'admin')", [roomId, u.user.id]);

      const res = await request(app).put(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${u.token}`).send({ name: 'ひみつの名前' });
      expect(res.status).toBe(200);
      await settle();
      const l = lines(info, '[change]');
      expect(l).toHaveLength(1);
      expect(l[0]).toMatch(new RegExp(`^\\[change\\] PUT /api/rooms/${roomId} 200 by=${u.user.id.slice(0, 8)} `));
      expect(l[0]).toMatch(/fields=name$/);
      expect(l[0]).not.toContain('ひみつの名前');
    });

    it('パスワードの値は残さない (欄の名前だけ)', async () => {
      const admin: TestUser = await createTestUser();
      const target: TestUser = await createTestUser();
      await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
      const res = await request(app).put(`/api/admin/users/${target.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`).send({ password: 'new-secret-pass', role: 'user' });
      expect(res.status).toBe(200);
      await settle();
      const l = lines(info, '[change]');
      expect(l).toHaveLength(1);
      expect(l[0]).toContain(`/api/admin/users/${target.user.id}`);
      expect(l[0]).toContain(`by=${admin.user.id.slice(0, 8)}`);
      expect(l[0]).toMatch(/fields=password,role$/);
      expect(l[0]).not.toContain('new-secret-pass');
    });

    it('ログインの要求は変更として残さない (パスワードを扱う口なので、欄の名前も出さない)', async () => {
      await request(app).post('/api/auth/login').send({ login_id: 'nobody', password: 'x' });
      await settle();
      expect(lines(info, '[change]')).toHaveLength(0);
    });

    it('既読・プッシュの登録・通行証の発行は変更として残さない (1 日に数百回ある日常の操作)', async () => {
      const u: TestUser = await createTestUser();
      const pool = getTestPool();
      const room = await pool.query<{ id: string }>(
        "INSERT INTO rooms (name, type, created_by) VALUES ('既読の試し', 'group', $1) RETURNING id", [u.user.id]);
      await pool.query("INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member')", [room.rows[0].id, u.user.id]);
      const msg = await pool.query<{ id: string }>(
        "INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'こんにちは') RETURNING id", [room.rows[0].id, u.user.id]);
      const res = await request(app).post(`/api/rooms/${room.rows[0].id}/read`)
        .set('Authorization', `Bearer ${u.token}`).send({ message_ids: [msg.rows[0].id] });
      expect(res.status).toBeLessThan(300);
      await settle();
      expect(lines(info, '[change]')).toHaveLength(0);
    });

    it('読むだけの要求は残さない', async () => {
      const u: TestUser = await createTestUser();
      await request(app).get('/api/rooms').set('Authorization', `Bearer ${u.token}`);
      await settle();
      expect(lines(info, '[change]')).toHaveLength(0);
    });
  });
});
