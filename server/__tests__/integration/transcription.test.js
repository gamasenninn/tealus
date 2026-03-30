const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

const fixturesDir = path.join(__dirname, '../fixtures');

function ensureVoiceFixture() {
  const voicePath = path.join(fixturesDir, 'test.webm');
  if (!fs.existsSync(voicePath)) {
    fs.writeFileSync(voicePath, Buffer.alloc(1024, 0));
  }
  return voicePath;
}

describe('Voice Transcription', () => {
  let user1, user2, roomId, voicePath;

  beforeAll(async () => {
    await setupTestDb();
    voicePath = ensureVoiceFixture();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ employee_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ employee_id: 'EMP002', display_name: '鈴木花子' });

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  it('should create a pending transcription when voice message is uploaded', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomId}/voice`)
      .set('Authorization', `Bearer ${user1.token}`)
      .attach('voice', voicePath);

    expect(res.status).toBe(201);

    const pool = getTestPool();
    const trans = await pool.query(
      'SELECT * FROM voice_transcriptions WHERE message_id = $1',
      [res.body.message.id]
    );
    expect(trans.rows).toHaveLength(1);
    expect(['pending', 'transcribing']).toContain(trans.rows[0].status);
  });

  it('should include transcription in message history', async () => {
    const uploadRes = await request(app)
      .post(`/api/rooms/${roomId}/voice`)
      .set('Authorization', `Bearer ${user1.token}`)
      .attach('voice', voicePath);

    // Wait for async transcription to settle (will fail on dummy file)
    await new Promise(r => setTimeout(r, 500));

    // Simulate transcription completion after background process settles
    const pool = getTestPool();
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'done', raw_text = 'テスト文字起こし', formatted_text = '整形済みテスト'
       WHERE message_id = $1`,
      [uploadRes.body.message.id]
    );

    const res = await request(app)
      .get(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`);

    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].transcription).toBeDefined();
    expect(res.body.messages[0].transcription.raw_text).toBe('テスト文字起こし');
    expect(res.body.messages[0].transcription.formatted_text).toBe('整形済みテスト');
    expect(res.body.messages[0].transcription.status).toBe('done');
  });
});
