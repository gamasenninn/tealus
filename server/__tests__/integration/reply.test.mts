import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { pool } from '../../src/db/pool.mts';
import { fetchReplyMessage } from '../../src/socket/handlers/message.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('Reply Feature', () => {
  let user1: TestUser, user2: TestUser, roomId: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });

    const roomRes = await request(app)
      .post('/api/rooms/direct')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ partner_id: user2.user.id });
    roomId = roomRes.body.room.id;
  });

  it('should send a reply to a message', async () => {
    // Send original message
    const origRes = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: 'こんにちは' });
    const originalId = origRes.body.message.id;

    // Send reply
    const replyRes = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user2.token}`)
      .send({ content: 'こんにちは！元気？', reply_to: originalId });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.message.reply_to).toBe(originalId);
  });

  it('should include reply_to message info in history', async () => {
    const origRes = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: '元のメッセージ' });
    const originalId = origRes.body.message.id;

    await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user2.token}`)
      .send({ content: 'リプライです', reply_to: originalId });

    const res = await request(app)
      .get(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`);

    // Most recent message is the reply
    const reply = res.body.messages[0];
    expect(reply.content).toBe('リプライです');
    expect(reply.reply_to).toBe(originalId);
    expect(reply.reply_to_message).toBeDefined();
    expect(reply.reply_to_message.content).toBe('元のメッセージ');
    expect(reply.reply_to_message.sender_display_name).toBe('田中太郎');
  });

  it('should handle reply to non-existent message gracefully', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: 'リプライ', reply_to: '00000000-0000-0000-0000-000000000000' });

    // ★ #482 (2026-10-02): 入口で確かめて 403 を返す。以前は DB の外部キーで落ちて 500 だった
    expect(res.status).toBe(403);
  });

  it('should work without reply_to (normal message)', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: '普通のメッセージ' });

    expect(res.status).toBe(201);
    expect(res.body.message.reply_to).toBeNull();
  });

  // ★ #501 元を消したら、引用にも本文を出さない。
  //   ★★ 音声は削除しても voice_transcriptions が残るので、引用が文字起こしに落ちて消した中身が出ていた
  describe('元の投稿を削除したとき (#501)', () => {
    async function replyTo(originalId: string) {
      await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ content: 'リプライです', reply_to: originalId });
    }
    async function deleteMsg(id: string) {
      const del = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${id}`)
        .set('Authorization', `Bearer ${user1.token}`);
      expect(del.status).toBe(200);
    }
    async function quoteInHistory() {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user2.token}`);
      return res.body.messages.find((m: { content: string }) => m.content === 'リプライです').reply_to_message;
    }

    it('★ 文字の投稿: 引用は削除済みと分かり、本文を返さない', async () => {
      const orig = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '消す予定の本文' });
      await replyTo(orig.body.message.id);
      await deleteMsg(orig.body.message.id);

      const q = await quoteInHistory();
      expect(q.is_deleted).toBe(true);
      expect(q.content).toBeNull();
      expect(q.sender_display_name).toBe('田中太郎');
    });

    it('★★ 音声の投稿: 消したあと引用に文字起こしが出ない', async () => {
      const v = await pool.query<{ id: string }>(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', NULL) RETURNING id`,
        [roomId, user1.user.id]
      );
      await pool.query(
        `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version)
         VALUES ($1, '消す予定の生のおと', '消す予定の整形', 'done', 1)`,
        [v.rows[0].id]
      );
      await replyTo(v.rows[0].id);
      // 消す前は文字起こしが引用に出る (これは正しい)
      expect((await quoteInHistory()).content).toBe('消す予定の整形');

      await deleteMsg(v.rows[0].id);
      const q = await quoteInHistory();
      expect(q.is_deleted).toBe(true);
      expect(q.content).toBeNull();
      expect(q.transcription_text).toBeNull();
      expect(q.transcription_raw).toBeNull();
    });

    it('★ 送る瞬間に元が消えていた場合も、配る引用に本文を載せない (fetchReplyMessage)', async () => {
      const orig = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '消す予定の本文' });
      await deleteMsg(orig.body.message.id);
      const q = await fetchReplyMessage(orig.body.message.id);
      expect(q?.is_deleted).toBe(true);
      expect(q?.content).toBeNull();
    });
  });
});
