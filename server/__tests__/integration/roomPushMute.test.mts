/**
 * ルームごとに通知を鳴らさないようにする (#463, 2026-09-28)
 *
 * ★ 各自が自分の分だけ切り替える。既定は鳴らす。
 * ★ 鳴らさないを選んだ人は sendPushToRoomMembers の送り先から外れる。
 * ★ 通話の着信は止めない (sendPushToUser を直接呼ぶ経路なので、ここでは触らない)。
 */
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: {
  setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => mockSend(...a),
} }));

import request from 'supertest';
import { app } from '../../src/app.mts';
import { sendPushToRoomMembers } from '../../src/services/push.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('ルームごとの通知オフ', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let me: TestUser, other: TestUser, outsider: TestUser, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    me = await createTestUser({ login_id: 'EMP001', display_name: '自分' });
    other = await createTestUser({ login_id: 'EMP002', display_name: '相手' });
    outsider = await createTestUser({ login_id: 'EMP003', display_name: 'よその人' });
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${me.token}`)
      .send({ name: 'テストルーム', member_ids: [other.user.id] });
    roomId = roomRes.body.room.id;
  });

  const muted = async (userId: string) =>
    (await getTestPool().query('SELECT push_muted FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId])).rows[0].push_muted;

  it('既定は鳴らす。ルームの詳細で自分の設定が返る', async () => {
    const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.room.push_muted).toBe(false);
  });

  it('★ 自分の分だけを鳴らさないにでき、戻せる', async () => {
    const off = await request(app).put(`/api/rooms/${roomId}/notification`).set('Authorization', `Bearer ${me.token}`).send({ muted: true });
    expect(off.status).toBe(200);
    expect(off.body.push_muted).toBe(true);
    expect(await muted(me.user.id)).toBe(true);
    expect(await muted(other.user.id)).toBe(false);

    const detail = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${me.token}`);
    expect(detail.body.room.push_muted).toBe(true);

    const on = await request(app).put(`/api/rooms/${roomId}/notification`).set('Authorization', `Bearer ${me.token}`).send({ muted: false });
    expect(on.body.push_muted).toBe(false);
    expect(await muted(me.user.id)).toBe(false);
  });

  it('muted が真偽値でなければ 400', async () => {
    const res = await request(app).put(`/api/rooms/${roomId}/notification`).set('Authorization', `Bearer ${me.token}`).send({ muted: 'yes' });
    expect(res.status).toBe(400);
  });

  it('メンバーでなければ 403', async () => {
    const res = await request(app).put(`/api/rooms/${roomId}/notification`).set('Authorization', `Bearer ${outsider.token}`).send({ muted: true });
    expect(res.status).toBe(403);
  });

  it('★★ 鳴らさないを選んだ人には送らない (選んでいない人には送る)', async () => {
    const pool = getTestPool();
    for (const u of [me, other]) {
      await pool.query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, $2, 'p', 'a')`,
        [u.user.id, `https://push.example/${u.user.id}`]);
    }
    await request(app).put(`/api/rooms/${roomId}/notification`).set('Authorization', `Bearer ${other.token}`).send({ muted: true });

    // outsider が送り手のつもりで、me と other の両方に届く状況を作る
    await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, outsider.user.id]);
    await sendPushToRoomMembers(roomId, outsider.user.id, { title: 't', body: 'b' }, new Set());

    const endpoints = mockSend.mock.calls.map(c => c[0].endpoint);
    expect(endpoints).toEqual([`https://push.example/${me.user.id}`]);
  });
});
