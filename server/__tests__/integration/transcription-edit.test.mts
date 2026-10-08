import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool, waitTranscriptionSettled } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

const fixturesDir = path.join(import.meta.dirname, '../fixtures');

function ensureVoiceFixture() {
  const voicePath = path.join(fixturesDir, 'test.webm');
  if (!fs.existsSync(voicePath)) {
    fs.writeFileSync(voicePath, Buffer.alloc(1024, 0));
  }
  return voicePath;
}

describe('Transcription Edit API', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let user1: TestUser, user2: TestUser, roomId: string, messageId: string, voicePath: string;

  beforeAll(async () => {
    await setupTestDb();
    voicePath = ensureVoiceFixture();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;

    // Create voice message
    const uploadRes = await request(app)
      .post(`/api/rooms/${roomId}/voice`)
      .set('Authorization', `Bearer ${user1.token}`)
      .attach('voice', voicePath);
    messageId = uploadRes.body.message.id;

    // 裏の文字起こしが書き終わるまで待ってから完了を模す (固定時間の待ちは、遅れた場合に上書きされる)
    await waitTranscriptionSettled(messageId);
    const pool = getTestPool();
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'done', raw_text = '元のテキスト', formatted_text = '整形済みテキスト' WHERE message_id = $1`,
      [messageId]
    );
  });

  // ============================================
  // PUT /api/messages/:id/transcription
  // ============================================
  describe('PUT /api/messages/:id/transcription', () => {
    it('should edit transcription text', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '編集後のテキスト' });

      expect(res.status).toBe(200);
      expect(res.body.transcription.formatted_text).toBe('編集後のテキスト');
      expect(res.body.transcription.version).toBe(2);
    });

    it('should reject edit by non-sender', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ text: '不正な編集' });

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .send({ text: 'test' });

      expect(res.status).toBe(401);
    });

    it('should reject empty text', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '' });

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // GET /api/messages/:id/transcription/history
  // ============================================
  describe('GET /api/messages/:id/transcription/history', () => {
    it('should return edit history', async () => {
      // Edit twice
      await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '編集v2' });

      await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '編集v3' });

      const res = await request(app)
        .get(`/api/messages/${messageId}/transcription/history`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.history.length).toBe(3); // v1(original) + v2 + v3
      expect(res.body.history[0].version).toBe(3); // newest first
      expect(res.body.history[2].version).toBe(1);
    });

    it('should reject non-member', async () => {
      const user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });
      const res = await request(app)
        .get(`/api/messages/${messageId}/transcription/history`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // POST /api/messages/:id/transcription/retranscribe (#216)
  // ============================================
  describe('POST /api/messages/:id/transcription/retranscribe', () => {
    it('should create new pending version (status 202) and increment version', async () => {
      const res = await request(app)
        .post(`/api/messages/${messageId}/transcription/retranscribe`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(202);
      expect(res.body.message_id).toBe(messageId);
      expect(res.body.version).toBe(2);
      expect(res.body.status).toBe('pending');

      // Verify DB state
      const pool = getTestPool();
      const result = await pool.query(
        'SELECT version, status, edited_by FROM voice_transcriptions WHERE message_id = $1 ORDER BY version DESC LIMIT 1',
        [messageId]
      );
      expect(result.rows[0].version).toBe(2);
      expect(result.rows[0].edited_by).toBe(user1.user.id);
    });

    it('should preserve previous version', async () => {
      await request(app)
        .post(`/api/messages/${messageId}/transcription/retranscribe`)
        .set('Authorization', `Bearer ${user1.token}`);

      const pool = getTestPool();
      const result = await pool.query(
        'SELECT version, formatted_text FROM voice_transcriptions WHERE message_id = $1 ORDER BY version ASC',
        [messageId]
      );
      expect(result.rows.length).toBe(2);
      expect(result.rows[0].version).toBe(1);
      expect(result.rows[0].formatted_text).toBe('整形済みテキスト'); // v1 preserved
      expect(result.rows[1].version).toBe(2);
    });

    it('should reject retranscribe by non-sender (when allow_member_transcription_edit=false)', async () => {
      const res = await request(app)
        .post(`/api/messages/${messageId}/transcription/retranscribe`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(403);
    });

    it('should allow retranscribe by other member when allow_member_transcription_edit=true', async () => {
      const pool = getTestPool();
      await pool.query(
        'UPDATE rooms SET allow_member_transcription_edit = true WHERE id = $1',
        [roomId]
      );

      const res = await request(app)
        .post(`/api/messages/${messageId}/transcription/retranscribe`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(202);
      expect(res.body.version).toBe(2);
    });

    it('should reject retranscribe of non-existent message', async () => {
      const res = await request(app)
        .post(`/api/messages/00000000-0000-0000-0000-000000000000/transcription/retranscribe`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(404);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post(`/api/messages/${messageId}/transcription/retranscribe`);

      expect(res.status).toBe(401);
    });
  });

  // ============================================
  // ★ 部屋を抜けた送り手 (2026-10-02、利用者判断)
  //   以前は送り手本人なら部屋のメンバーかを見ずに、手直し・やり直しができた (履歴は読めないのに)。
  //   文字の投稿の編集 (requireMember) と揃えて、今のメンバーだけにする。本番で抜けた後の手直しは 0 件だった
  // ============================================
  describe('★ 部屋を抜けた送り手', () => {
    const versions = async () => (await getTestPool().query<{ n: number }>(
      'SELECT count(*)::int n FROM voice_transcriptions WHERE message_id = $1', [messageId])).rows[0].n;
    beforeEach(async () => {
      await getTestPool().query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, user1.user.id]);
    });

    it('手直しは 403 で、版は増えない', async () => {
      const before = await versions();
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '抜けた後の手直し' });
      expect(res.status).toBe(403);
      expect(await versions()).toBe(before);
    });

    it('やり直しは 403 で、版は増えない', async () => {
      const before = await versions();
      const res = await request(app)
        .post(`/api/messages/${messageId}/transcription/retranscribe`)
        .set('Authorization', `Bearer ${user1.token}`);
      expect(res.status).toBe(403);
      expect(await versions()).toBe(before);
    });
  });
  // ============================================
  // ★ #522 消した音声 (2026-10-08 UI 試験)
  //   消しても文字起こしの手直し・やり直し (費用がかかる)・履歴が通っていた。
  //   履歴は部屋のメンバーなら誰でも読めるので、消した中身を読む口にもなっていた
  // ============================================
  describe('★ #522 消した音声', () => {
    const versions = async () => (await getTestPool().query<{ n: number }>(
      'SELECT count(*)::int n FROM voice_transcriptions WHERE message_id = $1', [messageId])).rows[0].n;
    beforeEach(async () => {
      const del = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${messageId}`)
        .set('Authorization', `Bearer ${user1.token}`);
      expect(del.status).toBe(200);
    });

    it('手直しは 404 で、版は増えない', async () => {
      const before = await versions();
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '消した後の手直し' });
      expect(res.status).toBe(404);
      expect(await versions()).toBe(before);
    });

    it('やり直しは 404 で、版は増えない', async () => {
      const before = await versions();
      const res = await request(app)
        .post(`/api/messages/${messageId}/transcription/retranscribe`)
        .set('Authorization', `Bearer ${user1.token}`);
      expect(res.status).toBe(404);
      expect(await versions()).toBe(before);
    });

    it('履歴は 404 (送り手も、他のメンバーも)', async () => {
      for (const u of [user1, user2]) {
        const res = await request(app)
          .get(`/api/messages/${messageId}/transcription/history`)
          .set('Authorization', `Bearer ${u.token}`);
        expect(res.status).toBe(404);
      }
    });

    it('部屋の一覧には、ファイルも文字起こしも付けない', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user2.token}`);
      const m = res.body.messages.find((x: { id: string }) => x.id === messageId);
      expect(m.is_deleted).toBe(true);
      expect(m.media).toEqual([]);
      expect(m.transcription ?? null).toBeNull();
    });

    it('消していない音声には、今までどおりファイルと文字起こしが付く', async () => {
      const up = await request(app)
        .post(`/api/rooms/${roomId}/voice`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('voice', voicePath);
      const liveId = up.body.message.id;
      await waitTranscriptionSettled(liveId);
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user2.token}`);
      const m = res.body.messages.find((x: { id: string }) => x.id === liveId);
      expect(m.media.length).toBe(1);
      expect(m.transcription).toBeTruthy();
    });
  });
});
