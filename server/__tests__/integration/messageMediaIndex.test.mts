/**
 * #549 message_media に message_id の索引がある (添付はいつもメッセージから引く)。
 * ★ 以前は主キーだけで、メッセージを読むたびに全行を読んでいた (2026-10-10 に 2.5 万行 × 13.7 万回)
 */
import { setupTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await closeTestDb(); });

test('★ message_media(message_id) の索引がある', async () => {
  const { rows } = await getTestPool().query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'message_media' AND indexname = 'idx_message_media_message'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].indexdef).toMatch(/\(message_id\)/);
});
