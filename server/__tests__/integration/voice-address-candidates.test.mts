import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

// 音声の編集画面に並べる「宛名の候補」。部屋で人が直した版の冒頭の呼びかけを多い順に
describe('GET /api/rooms/:id/voice-address-candidates', () => {
  let user1: TestUser, user2: TestUser, outsider: TestUser, roomId: string;

  /** 音声を 1 件作り、機械の版 (edited_by なし) と人の版を積む */
  async function voiceWithEdits(machine: string, human: string | null, opts: { deleted?: boolean } = {}) {
    const pool = getTestPool();
    const m = await pool.query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, type, content, is_deleted) VALUES ($1, $2, 'voice', NULL, $3) RETURNING id`,
      [roomId, user1.user.id, !!opts.deleted]
    );
    const id = m.rows[0].id;
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, raw_text, formatted_text, status) VALUES ($1, 1, $2, $2, 'done')`,
      [id, machine]
    );
    if (human !== null) {
      await pool.query(
        `INSERT INTO voice_transcriptions (message_id, version, raw_text, formatted_text, status, edited_by) VALUES ($1, 2, $2, $3, 'done', $4)`,
        [id, machine, human, user2.user.id]
      );
    }
    return id;
  }

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    outsider = await createTestUser({ login_id: 'EMP003', display_name: '部外者' });
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'トランシーバー', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  it('人が直した版の冒頭の呼びかけを多い順に返す (機械の版は数えない)', async () => {
    await voiceWithEdits('佐藤さん、取れます？', '斎藤さん、取れます？');
    await voiceWithEdits('小川さん、分かる？', '斎藤さん、分かる？');
    await voiceWithEdits('コマさん、取れますか？', 'ガマさん、取れますか？');
    await voiceWithEdits('ヤマハさん、終わったよ', 'ガマさん、終わったよ');
    await voiceWithEdits('川端さん、取れますか', 'ガマさん、取れますか');
    await voiceWithEdits('佐藤さん、機械のまま', null);
    await voiceWithEdits('佐藤さん、機械のまま 2', null);

    const res = await request(app)
      .get(`/api/rooms/${roomId}/voice-address-candidates`)
      .set('Authorization', `Bearer ${user1.token}`);

    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([
      { text: 'ガマさん', count: 3 },
      { text: '斎藤さん', count: 2 },
    ]);
  });

  it('同じ音声を何度直しても、最後の版だけを数える', async () => {
    const pool = getTestPool();
    const id = await voiceWithEdits('コマさん、a', '中さん、a');
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, raw_text, formatted_text, status, edited_by) VALUES ($1, 3, 'コマさん、a', 'ガマさん、a', 'done', $2)`,
      [id, user2.user.id]
    );
    await voiceWithEdits('コマさん、b', 'ガマさん、b');

    const res = await request(app)
      .get(`/api/rooms/${roomId}/voice-address-candidates`)
      .set('Authorization', `Bearer ${user1.token}`);

    expect(res.body.candidates).toEqual([{ text: 'ガマさん', count: 2 }]);
  });

  it('消した音声の版は数えない', async () => {
    await voiceWithEdits('a', '中さん、a', { deleted: true });
    await voiceWithEdits('b', '中さん、b', { deleted: true });

    const res = await request(app)
      .get(`/api/rooms/${roomId}/voice-address-candidates`)
      .set('Authorization', `Bearer ${user1.token}`);

    expect(res.body.candidates).toEqual([]);
  });

  it('部屋のメンバーでなければ 403', async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomId}/voice-address-candidates`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('ログインしていなければ 401', async () => {
    const res = await request(app).get(`/api/rooms/${roomId}/voice-address-candidates`);
    expect(res.status).toBe(401);
  });

  it('壊れた部屋 ID は 400', async () => {
    const res = await request(app)
      .get('/api/rooms/not-a-uuid/voice-address-candidates')
      .set('Authorization', `Bearer ${user1.token}`);
    expect(res.status).toBe(400);
  });
});
