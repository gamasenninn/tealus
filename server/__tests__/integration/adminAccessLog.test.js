/**
 * アクセスログ MVP-0 (#1) の統合テスト。
 *
 * 新規テーブルなし。既存の messages (投稿) と room_read_cursors (閲覧) を集計し、
 * GET /api/admin/access-log で返す:
 *   - users:  ユーザ別サマリ (users 基点 LEFT JOIN、未活動は null)
 *             { id, login_id, display_name, role, is_active, last_post_at, last_view_at }
 *   - matrix: (ユーザ×ルーム) 活動のある組のみ
 *             { user_id, room_id, room_name, last_post_at, last_view_at }
 *
 * last_post_at = messages の MAX(created_at) (is_deleted=false)
 * last_view_at = room_read_cursors.last_read_at
 */
const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

// 固定タイムスタンプ (決定的アサーション用)
const T = {
  user1_A1: '2026-06-10T02:00:00.000Z',
  user1_A2: '2026-06-12T05:00:00.000Z', // roomA での user1 最新
  user1_A_deleted: '2026-06-20T00:00:00.000Z', // 削除済 → 集計対象外
  user1_B: '2026-06-11T03:00:00.000Z',
  user2_A: '2026-06-13T06:00:00.000Z',
  view_user1_A: '2026-06-14T07:00:00.000Z',
  view_user1_B: '2026-06-09T07:00:00.000Z',
  view_user2_A: '2026-06-15T08:00:00.000Z',
  view_user2_B: '2026-06-08T01:00:00.000Z', // user2 は roomB を覗いたが投稿していない
};

function iso(v) {
  return new Date(v).getTime();
}

describe('GET /api/admin/access-log', () => {
  let admin, user1, user2, roomA, roomB;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    const pool = getTestPool();

    admin = await createTestUser({ login_id: 'ADMIN001', display_name: '管理者' });
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);

    // rooms
    const rA = await pool.query(
      "INSERT INTO rooms (type, name) VALUES ('group', '朝礼') RETURNING id"
    );
    const rB = await pool.query(
      "INSERT INTO rooms (type, name) VALUES ('group', '終礼') RETURNING id"
    );
    roomA = rA.rows[0].id;
    roomB = rB.rows[0].id;

    // messages (投稿)
    const insMsg = (room, sender, ts, deleted = false) =>
      pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type, is_deleted, created_at)
         VALUES ($1, $2, 'x', 'text', $3, $4)`,
        [room, sender, deleted, ts]
      );
    await insMsg(roomA, user1.user.id, T.user1_A1);
    await insMsg(roomA, user1.user.id, T.user1_A2);
    await insMsg(roomA, user1.user.id, T.user1_A_deleted, true); // 削除済
    await insMsg(roomB, user1.user.id, T.user1_B);
    await insMsg(roomA, user2.user.id, T.user2_A);

    // room_read_cursors (閲覧)
    const insView = (room, uid, ts) =>
      pool.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, NULL, $3)`,
        [room, uid, ts]
      );
    await insView(roomA, user1.user.id, T.view_user1_A);
    await insView(roomB, user1.user.id, T.view_user1_B);
    await insView(roomA, user2.user.id, T.view_user2_A);
    await insView(roomB, user2.user.id, T.view_user2_B);
  });

  // --- Authorization ---
  it('未認証は 401', async () => {
    const res = await request(app).get('/api/admin/access-log');
    expect(res.status).toBe(401);
  });

  it('非 admin は 403', async () => {
    const res = await request(app)
      .get('/api/admin/access-log')
      .set('Authorization', `Bearer ${user1.token}`);
    expect(res.status).toBe(403);
  });

  it('admin は 200 で users / matrix を返す', async () => {
    const res = await request(app)
      .get('/api/admin/access-log')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(Array.isArray(res.body.matrix)).toBe(true);
  });

  // --- users サマリ ---
  it('users: 全ユーザを含み、最終投稿/最終閲覧を集計 (未活動は null)', async () => {
    const res = await request(app)
      .get('/api/admin/access-log')
      .set('Authorization', `Bearer ${admin.token}`);

    const byId = Object.fromEntries(res.body.users.map(u => [u.id, u]));

    // admin: 投稿も閲覧もなし → null
    expect(byId[admin.user.id]).toBeDefined();
    expect(byId[admin.user.id].last_post_at).toBeNull();
    expect(byId[admin.user.id].last_view_at).toBeNull();
    expect(byId[admin.user.id]).toHaveProperty('display_name', '管理者');
    expect(byId[admin.user.id]).not.toHaveProperty('password_hash');

    // user1: last_post = max(roomA最新, roomB) = user1_A2、last_view = max = view_user1_A
    expect(iso(byId[user1.user.id].last_post_at)).toBe(iso(T.user1_A2));
    expect(iso(byId[user1.user.id].last_view_at)).toBe(iso(T.view_user1_A));

    // user2: last_post = user2_A、last_view = max(roomA, roomB) = view_user2_A
    expect(iso(byId[user2.user.id].last_post_at)).toBe(iso(T.user2_A));
    expect(iso(byId[user2.user.id].last_view_at)).toBe(iso(T.view_user2_A));
  });

  // --- matrix (ユーザ×ルーム) ---
  it('matrix: 投稿/閲覧のある (ユーザ×ルーム) を room 名付きで返す', async () => {
    const res = await request(app)
      .get('/api/admin/access-log')
      .set('Authorization', `Bearer ${admin.token}`);

    const cell = (uid, rid) =>
      res.body.matrix.find(m => m.user_id === uid && m.room_id === rid);

    // (user1, roomA): 投稿は user1_A2 (削除済は除外)、閲覧は view_user1_A
    const u1A = cell(user1.user.id, roomA);
    expect(u1A).toBeDefined();
    expect(u1A.room_name).toBe('朝礼');
    expect(iso(u1A.last_post_at)).toBe(iso(T.user1_A2));
    expect(iso(u1A.last_view_at)).toBe(iso(T.view_user1_A));

    // (user1, roomB)
    const u1B = cell(user1.user.id, roomB);
    expect(iso(u1B.last_post_at)).toBe(iso(T.user1_B));
    expect(iso(u1B.last_view_at)).toBe(iso(T.view_user1_B));

    // (user2, roomB): 閲覧のみ (投稿なし) → last_post_at は null だが行は存在
    const u2B = cell(user2.user.id, roomB);
    expect(u2B).toBeDefined();
    expect(u2B.last_post_at).toBeNull();
    expect(iso(u2B.last_view_at)).toBe(iso(T.view_user2_B));
  });
});
