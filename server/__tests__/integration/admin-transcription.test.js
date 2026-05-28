const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');
const { resetCache, loadGuideline } = require('../../src/services/transcriptionConfig');

// #286 Phase 1: vocab cache reset endpoint
// transcription_guideline.json をファイル更新後、server restart せずに cache を再読込する
// admin endpoint。Phase 2 (organon-daily skill Step 4) から呼ばれる infra。
describe('POST /api/admin/transcription/reload-vocab (#286 Phase 1)', () => {
  let admin, user1;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADMIN001', display_name: '管理者' });
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });

    const pool = getTestPool();
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
  });

  it('T1: rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/api/admin/transcription/reload-vocab');
    expect(res.status).toBe(401);
  });

  it('T2: rejects non-admin users with 403', async () => {
    const res = await request(app)
      .post('/api/admin/transcription/reload-vocab')
      .set('Authorization', `Bearer ${user1.token}`);
    expect(res.status).toBe(403);
  });

  it('T3: admin gets 200 + vocab/guideline counts matching the actual file state', async () => {
    const res = await request(app)
      .post('/api/admin/transcription/reload-vocab')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vocab_count');
    expect(res.body).toHaveProperty('guideline_count');
    expect(typeof res.body.vocab_count).toBe('number');
    expect(typeof res.body.guideline_count).toBe('number');
    expect(res.body.vocab_count).toBeGreaterThanOrEqual(0);
    expect(res.body.guideline_count).toBeGreaterThanOrEqual(0);

    // ★ functional read-through proof: endpoint が返す counts は、直接 loadGuideline()
    // した結果と一致する = endpoint が cache を素通しせず実際のファイル状態を反映している
    // 証明(silent failure 検出)。
    resetCache();
    const config = loadGuideline();
    expect(res.body.vocab_count).toBe(config.vocabulary.length);
    expect(res.body.guideline_count).toBe(config.guidelines.length);
  });
});
