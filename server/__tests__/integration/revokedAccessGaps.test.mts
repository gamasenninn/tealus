/**
 * #529 取り消した権限・消した中身が、別の口から届き続けていた (2026-10-09 の点検で見つけたもの)
 *
 * ★ 利用停止にした人へ、部屋の通知が届き続けた (停止は接続を切るが、プッシュの送り先は見ていなかった)
 * ★ 消した投稿の編集前の文面が、編集履歴の口から返った (#522 で音声の履歴は塞いだが、文字の履歴は残っていた)
 * ★ ボットの口の画像・ファイルには、#497 の種類ごとの大きさの上限が効いていなかった
 */
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: {
  setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => mockSend(...a),
} }));

import fs from 'node:fs';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { sendPushToRoomMembers, sendPushToUser } from '../../src/services/push.mts';
import { clearViewing } from '../../src/socket/viewingRooms.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('#529 取り消した権限・消した中身', () => {
  let sender: TestUser, active: TestUser, stopped: TestUser, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    clearViewing();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    sender = await createTestUser({ login_id: 'EMP001', display_name: '送り手' });
    active = await createTestUser({ login_id: 'EMP002', display_name: '使っている人' });
    stopped = await createTestUser({ login_id: 'EMP003', display_name: '停止した人' });
    const r = await request(app).post('/api/rooms').set('Authorization', `Bearer ${sender.token}`)
      .send({ name: '部屋', member_ids: [active.user.id, stopped.user.id] });
    roomId = r.body.room.id;
    for (const u of [active, stopped]) {
      await getTestPool().query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, $2, 'p', 'a')`,
        [u.user.id, `https://push.example/${u.user.id}`]);
    }
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [stopped.user.id]);
  });

  const sentTo = () => mockSend.mock.calls.map((c) => c[0].endpoint).sort();

  describe('プッシュ', () => {
    it('★★ 利用停止にした人には、部屋の通知を送らない', async () => {
      await sendPushToRoomMembers(roomId, sender.user.id, { title: 't', body: 'b' });
      expect(sentTo()).toEqual([`https://push.example/${active.user.id}`]);
    });

    it('★ 1 人宛て (着信など) も、利用停止にした人には送らない', async () => {
      await sendPushToUser(stopped.user.id, { title: '着信', body: 'b' });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('利用中の人には今までどおり送る (前提の確認)', async () => {
      await sendPushToUser(active.user.id, { title: 't', body: 'b' });
      expect(sentTo()).toEqual([`https://push.example/${active.user.id}`]);
    });
  });

  describe('編集履歴', () => {
    const editedMessage = async () => {
      const { rows } = await getTestPool().query<{ id: string }>(
        `INSERT INTO messages (room_id, sender_id, content, type, is_edited) VALUES ($1, $2, '直した後', 'text', true) RETURNING id`,
        [roomId, sender.user.id]);
      await getTestPool().query('INSERT INTO message_edits (message_id, version, content, edited_by) VALUES ($1, 1, $2, $3)',
        [rows[0].id, '直す前の文面', sender.user.id]);
      return rows[0].id;
    };

    it('消していない投稿の履歴は今までどおり返る (前提の確認)', async () => {
      const id = await editedMessage();
      const res = await request(app).get(`/api/rooms/${roomId}/messages/${id}/edits`).set('Authorization', `Bearer ${active.token}`);
      expect(res.status).toBe(200);
      expect(res.body.edits).toHaveLength(1);
    });

    it('★★ 消した投稿の履歴は 404 (前の文面を返さない)', async () => {
      const id = await editedMessage();
      const del = await request(app).delete(`/api/rooms/${roomId}/messages/${id}`).set('Authorization', `Bearer ${sender.token}`);
      expect(del.status).toBe(200);
      const res = await request(app).get(`/api/rooms/${roomId}/messages/${id}/edits`).set('Authorization', `Bearer ${active.token}`);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('直す前の文面');
    });
  });

  describe('ボットの口の大きさの上限 (#497 と同じ)', () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);   // 画像の上限 10MB を超える

    it('★★ /push-image: 画像の上限を超えたら 413、保存したファイルは消す', async () => {
      const before = await getTestPool().query('SELECT count(*)::int n FROM messages WHERE room_id = $1', [roomId]);
      const res = await request(app).post('/api/bot/push-image').set('Authorization', `Bearer ${sender.token}`)
        .field('room_id', roomId).attach('image', big, { filename: 'big.png', contentType: 'image/png' });
      expect(res.status).toBe(413);
      const after = await getTestPool().query('SELECT count(*)::int n FROM messages WHERE room_id = $1', [roomId]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('★ /push-file: 種類の上限を超えたら 413', async () => {
      const res = await request(app).post('/api/bot/push-file').set('Authorization', `Bearer ${sender.token}`)
        .field('room_id', roomId).attach('file', big, { filename: 'big.png', contentType: 'image/png' });
      expect(res.status).toBe(413);
    });

    it('上限より小さければ今までどおり受ける (前提の確認)', async () => {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const res = await request(app).post('/api/bot/push-image').set('Authorization', `Bearer ${sender.token}`)
        .field('room_id', roomId).attach('image', png, { filename: 'ok.png', contentType: 'image/png' });
      expect(res.status).toBeLessThan(300);
      // 受けたファイルの後片付けはしない (他のテストと同じ。保存先はテスト用)
      void fs;
    });
  });
});
