/**
 * 既読位置が無いときの未読は、部屋に入った時刻から数える (2026-10-23、改善ループ 10 回目の A)
 *
 * ★ 入る前の便は「読んでいない」のではなく「その場にいなかった」。以前は 1970 年から数えていて、
 *   招待された人に部屋の履歴が全部未読で出ていた (営業報告の 3 人が 282 件など)。docs/02 §既読の動作仕様
 * ★★ 同じ数え方をする口が 4 つある。1 つだけ直すと一覧とバッジで数が食い違うので、全部ここで見る
 */
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: {
  setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => mockSend(...a),
} }));

import request from 'supertest';
import { app } from '../../src/app.mts';
import { sendPushToUser } from '../../src/services/push.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('既読位置が無いときは、入った時刻から数える', () => {
  let me: { id: string; token: string };
  let roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    const pool = getTestPool();
    const m = await createTestUser({ login_id: 'EMP301', display_name: '招かれた人' });
    const o = await createTestUser({ login_id: 'EMP302', display_name: '前からいる人' });
    me = { id: m.user.id, token: m.token };

    roomId = (await pool.query<{ id: string }>(`INSERT INTO rooms (type, name) VALUES ('group', '営業報告') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO room_members (room_id, user_id, joined_at) VALUES ($1, $2, '2026-01-01T00:00:00Z')`, [roomId, o.user.id]);
    await pool.query(`INSERT INTO room_members (room_id, user_id, joined_at) VALUES ($1, $2, '2026-10-01T00:00:00Z')`, [roomId, me.id]);

    // 入る前に 3 便、入った後に 2 便 (どれも既読位置は無い)
    for (const at of ['2026-09-01', '2026-09-15', '2026-09-30', '2026-10-02', '2026-10-03']) {
      await pool.query(`INSERT INTO messages (room_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, 'text', $4)`,
        [roomId, o.user.id, `便 ${at}`, `${at}T00:00:00Z`]);
    }
  });

  it('部屋の一覧の未読は、入った後の 2 便だけ', async () => {
    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.rooms.find((r: { id: string }) => r.id === roomId).unread_count).toBe(2);
  });

  it('通知のバッジの合計も 2 (一覧と食い違わない)', async () => {
    await getTestPool().query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, 'https://push.example/x', 'p', 'a')`, [me.id]);
    await sendPushToUser(me.id, { title: 't', body: 'b' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSend.mock.calls[0][1]).total_unread).toBe(2);
  });

  it('「全部既読」が数える件数も 2', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/read/all`).set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('AI の未読取得も入った後の 2 便だけ (部屋を指定しても、しなくても)', async () => {
    const one = await request(app).get(`/api/bot/unread?room_id=${roomId}`).set('Authorization', `Bearer ${me.token}`);
    expect(one.status).toBe(200);
    expect(one.body.messages.map((m: { content: string }) => m.content)).toEqual(['便 2026-10-02', '便 2026-10-03']);

    const all = await request(app).get('/api/bot/unread').set('Authorization', `Bearer ${me.token}`);
    expect(all.status).toBe(200);
    expect(all.body.messages.map((m: { content: string }) => m.content)).toEqual(['便 2026-10-02', '便 2026-10-03']);
  });

  it('既読位置があれば、そちらを使う (入った時刻より優先)', async () => {
    await getTestPool().query(
      `INSERT INTO room_read_cursors (room_id, user_id, last_read_at) VALUES ($1, $2, '2026-10-02T12:00:00Z')`, [roomId, me.id]);
    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${me.token}`);
    expect(res.body.rooms.find((r: { id: string }) => r.id === roomId).unread_count).toBe(1);
  });
});
