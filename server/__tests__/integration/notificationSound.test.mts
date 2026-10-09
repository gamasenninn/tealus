/**
 * 通知音を鳴らすかをアカウントごとに選ぶ (2026-10-08)
 *
 * ★ それまでは端末ごとの保存 (localStorage) で、画面の中の音にしか効かなかった。
 *   プッシュの音は OS の設定でしか止められず、「切ったのに鳴る」と言われた。
 * ★ 切った人へのメッセージの通知には silent: true を付ける (通知そのものは出す)。
 *   iPhone のホーム画面アプリで効くことを確かめた (2026-10-08)。
 * ★ 部屋の一覧に各自の「このルームの通知」(push_muted) を載せる。画面の中の音もこれを見る。
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

describe('通知音の設定 (アカウントごと)', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let me: TestUser, other: TestUser, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    me = await createTestUser({ login_id: 'EMP001', display_name: '自分' });
    other = await createTestUser({ login_id: 'EMP002', display_name: '相手' });
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${me.token}`)
      .send({ name: 'テストルーム', member_ids: [other.user.id] });
    roomId = roomRes.body.room.id;
  });

  it('既定は鳴らす (/me に出る)', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${me.token}`);
    expect(res.body.user.notification_sound).toBe(true);
  });

  it('★ プロフィールで切り替えられ、戻せる (この項目だけでも保存できる)', async () => {
    const off = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`)
      .send({ notification_sound: false });
    expect(off.status).toBe(200);
    expect(off.body.user.notification_sound).toBe(false);
    const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${me.token}`);
    expect(meRes.body.user.notification_sound).toBe(false);

    const on = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`)
      .send({ notification_sound: true });
    expect(on.body.user.notification_sound).toBe(true);
  });

  it('★ 名前を変えても通知音の設定は返ってくる (画面の手元の情報から消えない)', async () => {
    const res = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`)
      .send({ display_name: '新しい名前' });
    expect(res.body.user.notification_sound).toBe(true);
  });

  it('真偽値でなければ 400', async () => {
    const res = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`)
      .send({ notification_sound: 'off' });
    expect(res.status).toBe(400);
  });

  it('★★ 切った人への通知には silent を付ける (切っていない人には付けない)', async () => {
    const pool = getTestPool();
    for (const u of [me, other]) {
      await pool.query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, $2, 'p', 'a')`,
        [u.user.id, `https://push.example/${u.user.id}`]);
    }
    await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${other.token}`)
      .send({ notification_sound: false });
    const sender = await createTestUser({ login_id: 'EMP003', display_name: '送り手' });
    await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, sender.user.id]);

    await sendPushToRoomMembers(roomId, sender.user.id, { title: 't', body: 'b' }, new Set());

    const byEndpoint = Object.fromEntries(mockSend.mock.calls.map(c => [c[0].endpoint, JSON.parse(c[1])]));
    expect(byEndpoint[`https://push.example/${other.user.id}`].silent).toBe(true);
    expect(byEndpoint[`https://push.example/${me.user.id}`].silent).toBeUndefined();
  });

  it('★ 部屋の一覧に自分の「このルームの通知」が載る', async () => {
    const before = await request(app).get('/api/rooms').set('Authorization', `Bearer ${me.token}`);
    expect(before.body.rooms.find((r: { id: string }) => r.id === roomId).push_muted).toBe(false);

    await request(app).put(`/api/rooms/${roomId}/notification`).set('Authorization', `Bearer ${me.token}`).send({ muted: true });
    const mine = await request(app).get('/api/rooms').set('Authorization', `Bearer ${me.token}`);
    expect(mine.body.rooms.find((r: { id: string }) => r.id === roomId).push_muted).toBe(true);
    const theirs = await request(app).get('/api/rooms').set('Authorization', `Bearer ${other.token}`);
    expect(theirs.body.rooms.find((r: { id: string }) => r.id === roomId).push_muted).toBe(false);
  });

  // ★ #532 ログインの返事に入っておらず、ログインし直した直後は画面が「鳴らす」と見なした (#516 の取りこぼし)
  it('★ 切っている人がログインし直すと、ログインの返事にも「切っている」が入る', async () => {
    await getTestPool().query('UPDATE users SET notification_sound = false WHERE id = $1', [me.user.id]);
    const res = await request(app).post('/api/auth/login').send({ login_id: 'EMP001', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user.notification_sound).toBe(false);
  });
});
