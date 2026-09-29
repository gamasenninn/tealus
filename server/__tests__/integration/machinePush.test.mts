/**
 * 機械 (is_bot) の投稿でも通知を鳴らすかを、ルームごとに管理者が選ぶ (#463, 2026-09-28)
 *
 * ★ 既定は鳴らさない (今までと同じ)。rooms.push_machine_posts = true のルームだけ鳴らす。
 * ★ 人の投稿はこの設定に関係なく鳴る (media-voice-push.test が見ている)。
 * ★ 連投もまとめずに 1 件ずつ鳴らす (利用者判断)。
 * ★ 各自のオフ (room_members.push_muted) は sendPushToRoomMembers の中で効く (roomPushMute.test)。
 */
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

const mockPush = jest.fn();
jest.mock('../../src/services/push.mts', () => ({
  ...jest.requireActual('../../src/services/push.mts'),
  sendPushToRoomMembers: (...a: unknown[]) => mockPush(...a),
}));

import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool, waitTranscriptionSettled } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

const fixturesDir = path.join(import.meta.dirname, '../fixtures');

describe('機械の投稿の通知 (ルームごとに管理者が選ぶ)', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let admin: TestUser, member: TestUser, bot: TestUser, roomId: string;
  let pngPath: string, voicePath: string, txtPath: string;

  beforeAll(async () => {
    await setupTestDb();
    fs.mkdirSync(fixturesDir, { recursive: true });
    pngPath = path.join(fixturesDir, 'test.png');
    if (!fs.existsSync(pngPath)) {
      await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(pngPath);
    }
    voicePath = path.join(fixturesDir, 'test.webm');
    if (!fs.existsSync(voicePath)) fs.writeFileSync(voicePath, Buffer.alloc(1024, 0));
    txtPath = path.join(fixturesDir, 'test.txt');
    if (!fs.existsSync(txtPath)) fs.writeFileSync(txtPath, 'hello');
  });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    mockPush.mockClear();
    admin = await createTestUser({ login_id: 'EMP001', display_name: '管理者' });
    member = await createTestUser({ login_id: 'EMP002', display_name: 'メンバー' });
    bot = await createTestUser({ login_id: 'BOT001', display_name: '通話履歴ボット' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'テストルーム', member_ids: [member.user.id, bot.user.id] });
    roomId = roomRes.body.room.id;
  });

  const enable = () => request(app).put(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${admin.token}`)
    .send({ push_machine_posts: true });

  describe('設定', () => {
    it('既定は鳴らさない。ルームの詳細に出る', async () => {
      const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${member.token}`);
      expect(res.body.room.push_machine_posts).toBe(false);
    });

    it('管理者が変えられる', async () => {
      const res = await enable();
      expect(res.status).toBe(200);
      expect(res.body.room.push_machine_posts).toBe(true);
    });

    it('管理者でなければ変えられない (403)', async () => {
      const res = await request(app).put(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${member.token}`)
        .send({ push_machine_posts: true });
      expect(res.status).toBe(403);
    });
  });

  describe('ボットの投稿 (/api/bot/*)', () => {
    it('★ 設定がオフなら、テキストでも鳴らさない (今までと同じ)', async () => {
      const res = await request(app).post('/api/bot/push').set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: roomId, content: '【通話】要約' });
      expect(res.status).toBe(201);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('★★ 設定がオンなら、テキストを鳴らす (本文は先頭 100 字)', async () => {
      await enable();
      const content = 'あ'.repeat(150);
      const res = await request(app).post('/api/bot/push').set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: roomId, content });
      expect(res.status).toBe(201);
      expect(mockPush).toHaveBeenCalledTimes(1);
      const [rid, senderId, payload] = mockPush.mock.calls[0];
      expect(rid).toBe(roomId);
      expect(senderId).toBe(bot.user.id);
      expect(payload).toMatchObject({ title: '通話履歴ボット', body: 'あ'.repeat(100), data: { roomId, messageId: res.body.message.id } });
    });

    it('フォームは本文 (JSON) ではなく「📝 フォーム」', async () => {
      await enable();
      await request(app).post('/api/bot/push').set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: roomId, type: 'form', content: JSON.stringify({ title: 'q', questions: [] }) });
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush.mock.calls[0][2].body).toBe('📝 フォーム');
    });

    it('画像 (/push-image) を鳴らす', async () => {
      await enable();
      const res = await request(app).post('/api/bot/push-image').set('Authorization', `Bearer ${bot.token}`)
        .field('room_id', roomId).attach('image', pngPath);
      expect(res.status).toBe(201);
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush.mock.calls[0][2].body).toBe('📷 写真');
    });

    it('ファイル (/push-file) は本文があれば本文、無ければファイル名', async () => {
      await enable();
      await request(app).post('/api/bot/push-file').set('Authorization', `Bearer ${bot.token}`)
        .field('room_id', roomId).field('content', '【通話】sum_1 配送').attach('file', txtPath);
      await request(app).post('/api/bot/push-file').set('Authorization', `Bearer ${bot.token}`)
        .field('room_id', roomId).attach('file', txtPath);
      expect(mockPush).toHaveBeenCalledTimes(2);
      expect(mockPush.mock.calls[0][2].body).toBe('【通話】sum_1 配送');
      expect(mockPush.mock.calls[1][2].body).toBe('📎 test.txt');
    });
  });

  describe('ボットが画面と同じ口で上げたもの (トランシーバー等)', () => {
    it('★ 設定がオンなら、ボットの写真を鳴らす', async () => {
      await enable();
      const res = await request(app).post(`/api/rooms/${roomId}/media`).set('Authorization', `Bearer ${bot.token}`).attach('files', pngPath);
      expect(res.status).toBe(201);
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush.mock.calls[0][2].body).toBe('📷 写真');
    });

    it('★ 設定がオンなら、ボットの音声を鳴らす', async () => {
      await enable();
      const res = await request(app).post(`/api/rooms/${roomId}/voice`).set('Authorization', `Bearer ${bot.token}`).attach('voice', voicePath);
      expect(res.status).toBe(201);
      await waitTranscriptionSettled(res.body.message.id);
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush.mock.calls[0][2]).toMatchObject({ title: '通話履歴ボット', body: '🎤 音声メッセージ' });
    });

    it('設定がオフなら、ボットの音声は鳴らさない (今までと同じ)', async () => {
      const res = await request(app).post(`/api/rooms/${roomId}/voice`).set('Authorization', `Bearer ${bot.token}`).attach('voice', voicePath);
      await waitTranscriptionSettled(res.body.message.id);
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
