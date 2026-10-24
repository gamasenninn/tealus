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

  // ★ 改善ループ 12 回目: 退会しても既読位置は残る。戻った人は古い既読位置が勝って、いない間の便が未読になっていた
  it('抜けて戻った人は、古い既読位置より入り直した時刻が勝つ (いない間の便は未読にしない)', async () => {
    await getTestPool().query(
      `INSERT INTO room_read_cursors (room_id, user_id, last_read_at) VALUES ($1, $2, '2026-09-02T00:00:00Z')`, [roomId, me.id]);
    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${me.token}`);
    expect(res.body.rooms.find((r: { id: string }) => r.id === roomId).unread_count).toBe(2);
    const all = await request(app).get('/api/bot/unread').set('Authorization', `Bearer ${me.token}`);
    expect(all.body.messages.map((m: { content: string }) => m.content)).toEqual(['便 2026-10-02', '便 2026-10-03']);
    // ★ 改善ループ 13 回目: 通知のバッジ (push.mts) も同じ (pushUnreadTotal の例は既読位置が入った時刻より新しく、COALESCE でも通っていた)
    await getTestPool().query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, 'https://push.example/y', 'p', 'a')`, [me.id]);
    mockSend.mockClear();
    await sendPushToUser(me.id, { title: 't', body: 'b' });
    expect(JSON.parse(mockSend.mock.calls[0][1]).total_unread).toBe(2);
    const ra = await request(app).post(`/api/rooms/${roomId}/read/all`).set('Authorization', `Bearer ${me.token}`);
    expect(ra.body.count).toBe(2);
  });

  // ★ 改善ループ 12 回目: お知らせの「未読の点」(ホーム) も同じ数え方に。メンバーでない人 (お知らせは全員に出る) は今までどおり
  it('お知らせの未読の点: メンバーは入った時刻から、メンバーでない人はアカウントを作った時刻から', async () => {
    const pool = getTestPool();
    await pool.query('UPDATE rooms SET is_announcement = true WHERE id = $1', [roomId]);
    await pool.query('UPDATE messages SET is_published = true WHERE room_id = $1', [roomId]);
    const mine = await request(app).get('/api/rooms/announcements').set('Authorization', `Bearer ${me.token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.messages.filter((m: { is_unread: boolean }) => m.is_unread)).toHaveLength(2);

    // ★ 2026-10-24: メンバーでない人はアカウントを作った時刻より後のお知らせだけ未読 (新しく入った社員に過去分が全部並ばない)
    const outsider = await createTestUser({ login_id: 'EMP303', display_name: '部屋の外の人' });
    await pool.query(`UPDATE users SET created_at = '2026-09-20T00:00:00Z' WHERE id = $1`, [outsider.user.id]);
    const theirs = await request(app).get('/api/rooms/announcements').set('Authorization', `Bearer ${outsider.token}`);
    expect(theirs.body.messages.filter((m: { is_unread: boolean }) => m.is_unread)).toHaveLength(3);   // 09-30・10-02・10-03
  });

  // ★ 改善ループ 13 回目: 「ここから未読」の線も同じ。古い既読位置の次に線を出すと、いない間の便が未読に見える
  it('「ここから未読」の線: 既読位置が入り直した時刻より古ければ出さない (null)', async () => {
    const pool = getTestPool();
    const old = await pool.query<{ id: string }>(`SELECT id FROM messages WHERE room_id = $1 AND created_at = '2026-09-01T00:00:00Z'`, [roomId]);
    await pool.query(`INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at) VALUES ($1, $2, $3, '2026-09-01T00:00:00Z')`,
      [roomId, me.id, old.rows[0].id]);
    const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.last_read_message_id).toBeNull();
  });

  it('「ここから未読」の線: 入った後の既読位置なら今までどおり返す', async () => {
    const pool = getTestPool();
    const m = await pool.query<{ id: string }>(`SELECT id FROM messages WHERE room_id = $1 AND created_at = '2026-10-02T00:00:00Z'`, [roomId]);
    await pool.query(`INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at) VALUES ($1, $2, $3, '2026-10-02T00:00:00Z')`,
      [roomId, me.id, m.rows[0].id]);
    const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${me.token}`);
    expect(res.body.last_read_message_id).toBe(m.rows[0].id);
  });
});
