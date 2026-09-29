/**
 * 写真・動画のアップロードと音声メッセージにも、送り手が人のときだけプッシュ通知を付ける (2026-09-27、#383)
 *
 * ★ それまで: テキスト (socket) と転送には鳴るのに、アップロード (docs/07 #3) と音声 (#8) には無かった。
 * ★ 利用者判断「通知はなるべくあった方がよい (LINE 利用者は慣れている)」。ただし機械の流れは鳴らさない:
 *   トランシーバーの音声は 1 日 55 件・17 人。当時はルームごとの通知オフが無く、鳴らすと
 *   OS で Tealus の通知を丸ごと切るしかなくなり、人からの大事な通知まで消えた。
 *   ★ オフは 2026-09-28 に入った (#463) が、機械の流れを鳴らすかはまだ決めていない。
 * ★ 見分けは users.is_bot。トランシーバーのアカウントは is_bot = true に直した (2026-09-27 利用者了承)。
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
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

const fixturesDir = path.join(import.meta.dirname, '../fixtures');

describe('アップロードと音声のプッシュ通知 (送り手が人のときだけ)', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let human: TestUser, bot: TestUser, other: TestUser, roomId: string;
  let pngPath: string, voicePath: string;

  beforeAll(async () => {
    await setupTestDb();
    fs.mkdirSync(fixturesDir, { recursive: true });
    pngPath = path.join(fixturesDir, 'test.png');
    if (!fs.existsSync(pngPath)) {
      await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(pngPath);
    }
    voicePath = path.join(fixturesDir, 'test.webm');
    if (!fs.existsSync(voicePath)) fs.writeFileSync(voicePath, Buffer.alloc(1024, 0));
  });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    mockPush.mockClear();
    human = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    bot = await createTestUser({ login_id: 'PTT001', display_name: 'トランシーバー' });
    other = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${human.token}`)
      .send({ name: 'テストルーム', member_ids: [bot.user.id, other.user.id] });
    roomId = roomRes.body.room.id;
  });

  it('★★ 人が写真を上げると鳴らす (本文は「📷 写真」)', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/media`).set('Authorization', `Bearer ${human.token}`).attach('files', pngPath);
    expect(res.status).toBe(201);
    expect(mockPush).toHaveBeenCalledTimes(1);
    const [rid, senderId, payload] = mockPush.mock.calls[0];
    expect(rid).toBe(roomId);
    expect(senderId).toBe(human.user.id);
    expect(payload).toMatchObject({ title: '田中太郎', body: '📷 写真', data: { roomId, messageId: res.body.message.id } });
  });

  it('★★ 人が音声を送ると鳴らす (本文は「🎤 音声メッセージ」)', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/voice`).set('Authorization', `Bearer ${human.token}`).attach('voice', voicePath);
    expect(res.status).toBe(201);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][2]).toMatchObject({ title: '田中太郎', body: '🎤 音声メッセージ' });
  });

  it('★ ボット (トランシーバー等) の音声では鳴らさない', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/voice`).set('Authorization', `Bearer ${bot.token}`).attach('voice', voicePath);
    expect(res.status).toBe(201);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('★ ボットの写真では鳴らさない', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/media`).set('Authorization', `Bearer ${bot.token}`).attach('files', pngPath);
    expect(res.status).toBe(201);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
