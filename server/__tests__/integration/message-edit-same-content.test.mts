import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

/**
 * 文字の投稿を同じ文のまま保存しても版を積まない (2026-10-16、改善ループ 7 回目の小さいもの)
 *
 * ★ 音声の文字起こし (transcription.mts) は同日に直した。文字の投稿だけ同じ文で message_edits に版を積み、
 *   is_edited を立てていた (30 日で 2 件)。編集履歴に同じ中身が並び、「編集済み」の印も付く。
 */
describe('PUT /api/rooms/:id/messages/:msgId — 同じ文', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let user: TestUser, roomId: string, msgId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    user = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    const other = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    const room = await request(app).post('/api/rooms').set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'テスト', member_ids: [other.user.id] });
    roomId = room.body.room.id;
    const msg = await request(app).post(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${user.token}`)
      .send({ content: 'こんにちは' });
    msgId = msg.body.message.id;
  });

  const edit = (content: string) => request(app).put(`/api/rooms/${roomId}/messages/${msgId}`)
    .set('Authorization', `Bearer ${user.token}`).send({ content });

  it('★ 同じ文 (前後の空白だけ違う) なら版を積まず、編集済みにもしない', async () => {
    const res = await edit('  こんにちは  ');
    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe('こんにちは');
    expect(res.body.message.is_edited).toBe(false);
    const { rows } = await getTestPool().query('SELECT 1 FROM message_edits WHERE message_id = $1', [msgId]);
    expect(rows).toHaveLength(0);
  });

  it('違う文なら今までどおり版を積む', async () => {
    const res = await edit('こんばんは');
    expect(res.status).toBe(200);
    expect(res.body.message.is_edited).toBe(true);
    const { rows } = await getTestPool().query('SELECT content FROM message_edits WHERE message_id = $1', [msgId]);
    expect(rows).toEqual([{ content: 'こんにちは' }]);
  });

  // ★ 改善ループ 12 回目: 写真に後から付けた最初の説明文で「(編集済み)」が付き、履歴を開くと空だった (本番 9 件)
  it('★ 本文の無い便 (写真など) に最初の説明文を付けても、編集済みにしない・版も積まない', async () => {
    await getTestPool().query('UPDATE messages SET content = NULL WHERE id = $1', [msgId]);
    const res = await edit('現場の写真です');
    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe('現場の写真です');
    expect(res.body.message.is_edited).toBe(false);
    const { rows } = await getTestPool().query('SELECT 1 FROM message_edits WHERE message_id = $1', [msgId]);
    expect(rows).toHaveLength(0);
    // 2 回目からは今までどおり編集
    const again = await edit('現場の写真です (2 枚目)');
    expect(again.body.message.is_edited).toBe(true);
  });
});
