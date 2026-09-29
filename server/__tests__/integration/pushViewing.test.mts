/**
 * #475 PC を開いたままだとスマホに通知が届かなかった
 *
 * ★ 以前は「どの端末からでも接続している人」を送り先から外していた。
 * ★ いまは「その部屋をいま見ている人」だけを外す (画面側が room:viewing で知らせる)。
 * ★ 渡さなければ、送る側が viewingRooms から引く (呼ぶ側 6 か所で集合を作り間違えないように)。
 */
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: {
  setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => mockSend(...a),
} }));

import request from 'supertest';
import { app } from '../../src/app.mts';
import { sendPushToRoomMembers } from '../../src/services/push.mts';
import { setViewing, clearViewing } from '../../src/socket/viewingRooms.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('通知の送り先 — その部屋をいま見ている人だけ外す (#475)', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let sender: TestUser, a: TestUser, b: TestUser, roomId: string, otherRoomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    clearViewing();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    sender = await createTestUser({ login_id: 'EMP001', display_name: '送り手' });
    a = await createTestUser({ login_id: 'EMP002', display_name: 'A' });
    b = await createTestUser({ login_id: 'EMP003', display_name: 'B' });
    const r1 = await request(app).post('/api/rooms').set('Authorization', `Bearer ${sender.token}`)
      .send({ name: '部屋1', member_ids: [a.user.id, b.user.id] });
    roomId = r1.body.room.id;
    const r2 = await request(app).post('/api/rooms').set('Authorization', `Bearer ${sender.token}`)
      .send({ name: '部屋2', member_ids: [a.user.id] });
    otherRoomId = r2.body.room.id;
    for (const u of [a, b]) {
      await getTestPool().query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, $2, 'p', 'a')`,
        [u.user.id, `https://push.example/${u.user.id}`]);
    }
  });

  const sentTo = () => mockSend.mock.calls.map(c => c[0].endpoint).sort();

  it('★★ 誰も見ていなければ、送り手以外の全員に送る (接続しているかどうかは問わない)', async () => {
    await sendPushToRoomMembers(roomId, sender.user.id, { title: 't', body: 'b' });
    expect(sentTo()).toEqual([`https://push.example/${a.user.id}`, `https://push.example/${b.user.id}`].sort());
  });

  it('★★ その部屋を見ている人には送らない', async () => {
    setViewing('pc-of-a', a.user.id, roomId, true);
    await sendPushToRoomMembers(roomId, sender.user.id, { title: 't', body: 'b' });
    expect(sentTo()).toEqual([`https://push.example/${b.user.id}`]);
  });

  it('★★ 別の部屋を見ているだけなら送る (PC で別の部屋を開いたまま → スマホに届く)', async () => {
    setViewing('pc-of-a', a.user.id, otherRoomId, true);
    await sendPushToRoomMembers(roomId, sender.user.id, { title: 't', body: 'b' });
    expect(sentTo()).toContain(`https://push.example/${a.user.id}`);
  });

  it('★ 見なくなったら (画面が裏に回ったら) 送る', async () => {
    setViewing('pc-of-a', a.user.id, roomId, true);
    setViewing('pc-of-a', a.user.id, roomId, false);
    await sendPushToRoomMembers(roomId, sender.user.id, { title: 't', body: 'b' });
    expect(sentTo()).toContain(`https://push.example/${a.user.id}`);
  });
});
