/**
 * #336 汎用フォーム primitive: migration 026 で messages.type='form' が許可されることの
 * round-trip 検証。schema 変更が CHECK 制約拡張のみであることの裏取り。
 */
import { getTestPool, setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('messages.type = form (migration 026)', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let roomId: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user = await createTestUser({ login_id: 'EMP001', display_name: 'フォーム太郎' });
    const pool = getTestPool();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO rooms (name, type) VALUES ('フォームルーム', 'group') RETURNING id`,
    );
    roomId = rows[0].id;
  });

  it("type='form' の INSERT が成功する", async () => {
    const pool = getTestPool();
    const content = '朝の Q0\n\n```tealus-form\n{"version":1,"title":"Q0","fields":[]}\n```';
    const { rows } = await pool.query<{ id: string; type: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES ($1, $2, $3, 'form') RETURNING id, type`,
      [roomId, user.user.id, content],
    );
    expect(rows[0].type).toBe('form');
    expect(rows[0].id).toBeTruthy();
  });

  it('未知の type は CHECK 制約違反で失敗する (制約が生きている証拠)', async () => {
    const pool = getTestPool();
    await expect(
      pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type)
         VALUES ($1, $2, 'x', 'bogus_type') RETURNING id`,
        [roomId, user.user.id],
      ),
    ).rejects.toThrow(/messages_type_check|check constraint/i);
  });

  it("既存 type ('text','voice','stamp') も引き続き通る (回帰なし)", async () => {
    const pool = getTestPool();
    for (const t of ['text', 'voice', 'stamp']) {
      const { rows } = await pool.query<{ type: string }>(
        `INSERT INTO messages (room_id, sender_id, content, type)
         VALUES ($1, $2, 'c', $3) RETURNING type`,
        [roomId, user.user.id, t],
      );
      expect(rows[0].type).toBe(t);
    }
  });
});
