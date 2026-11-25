/**
 * 改善ループ 115: 1 対 1 の部屋の呼び名「A ↔ B」。webhook の payload (webhook.mts) と
 * `@cc-` の受け箱の room_name (ccIntake.mts) が同じ組み立てを別々に書いていた。1 つにまとめた。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { directRoomLabel } from '../../src/services/directRoomLabel.mts';

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await cleanTestDb(); });
afterAll(async () => { await closeTestDb(); });

describe('directRoomLabel', () => {
  it('メンバーの表示名を「 ↔ 」でつなぐ', async () => {
    const a = await createTestUser({ display_name: '田中' });
    const b = await createTestUser({ display_name: '鈴木' });
    const res = await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${a.token}`).send({ partner_id: b.user.id });
    const label = await directRoomLabel(res.body.room.id as string);
    expect(String(label).split(' ↔ ').sort()).toEqual(['田中', '鈴木']);
  });

  it('メンバーがいなければ null', async () => {
    expect(await directRoomLabel('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
