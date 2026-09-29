/**
 * #476 トーク画面で日付の頭へ飛ぶ — サーバー側の 2 本
 *
 * GET /api/rooms/:id/messages/days?month=YYYY-MM&tz_offset=分        その月で投稿がある日
 * GET /api/rooms/:id/messages/first-of-day?date=YYYY-MM-DD&tz_offset=分 その日の最初の投稿
 *
 * ★ tz_offset は画面の Date.getTimezoneOffset() (日本なら -540)。日の区切りを見ている人の時刻に合わせる
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('日付へ飛ぶ API (#476)', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let me: TestUser, outsider: TestUser, roomId: string;
  const JST = -540;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    me = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    outsider = await createTestUser({ login_id: 'EMP002', display_name: 'よその人' });
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${me.token}`)
      .send({ name: 'テストルーム', member_ids: [] });
    roomId = roomRes.body.room.id;
  });

  // 投稿を時刻を指定して置く (UTC の ISO で渡す)
  const post = async (isoUtc: string, opts: { deleted?: boolean } = {}) => {
    const r = await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, type, content, created_at, is_deleted)
       VALUES ($1, $2, 'text', 'x', $3, $4) RETURNING id`,
      [roomId, me.user.id, isoUtc, opts.deleted ?? false],
    );
    return r.rows[0].id;
  };
  const days = (month: string, tz = JST, token = me.token) =>
    request(app).get(`/api/rooms/${roomId}/messages/days`).query({ month, tz_offset: tz }).set('Authorization', `Bearer ${token}`);
  const first = (date: string, tz = JST, token = me.token) =>
    request(app).get(`/api/rooms/${roomId}/messages/first-of-day`).query({ date, tz_offset: tz }).set('Authorization', `Bearer ${token}`);

  describe('days', () => {
    it('★ その月で投稿がある日だけを、日付の順で返す', async () => {
      await post('2026-09-12T01:00:00Z');   // JST 9/12 10:00
      await post('2026-09-12T05:00:00Z');   // JST 9/12 14:00 (同じ日は 1 回)
      await post('2026-09-03T00:00:00Z');   // JST 9/3
      await post('2026-10-01T03:00:00Z');   // JST 10/1 (別の月)
      const res = await days('2026-09');
      expect(res.status).toBe(200);
      expect(res.body.days).toEqual(['2026-09-03', '2026-09-12']);
    });

    it('★★ 日の区切りは見ている人の時刻で決める (UTC の 9/30 16:00 は JST の 10/1)', async () => {
      await post('2026-09-30T16:00:00Z');
      expect((await days('2026-09')).body.days).toEqual([]);
      expect((await days('2026-10')).body.days).toEqual(['2026-10-01']);
      expect((await days('2026-09', 0)).body.days).toEqual(['2026-09-30']);   // UTC で見れば 9/30
    });

    it('消した投稿は数えない', async () => {
      await post('2026-09-05T01:00:00Z', { deleted: true });
      expect((await days('2026-09')).body.days).toEqual([]);
    });
  });

  describe('first-of-day', () => {
    it('★ その日の最初の投稿を返す (見ている人の時刻で)', async () => {
      await post('2026-09-11T14:59:00Z');                 // JST 9/11 23:59 (前の日)
      const firstId = await post('2026-09-11T15:00:00Z'); // JST 9/12 00:00
      await post('2026-09-12T03:00:00Z');                 // JST 9/12 12:00
      const res = await first('2026-09-12');
      expect(res.status).toBe(200);
      expect(res.body.message_id).toBe(firstId);
    });

    it('消した投稿は飛ばして、その次を返す', async () => {
      await post('2026-09-12T00:00:00Z', { deleted: true });
      const next = await post('2026-09-12T01:00:00Z');
      expect((await first('2026-09-12')).body.message_id).toBe(next);
    });

    it('投稿の無い日は null', async () => {
      expect((await first('2026-09-20')).body.message_id).toBeNull();
    });
  });

  describe('守り', () => {
    it('★ メンバーでなければ 403', async () => {
      expect((await days('2026-09', JST, outsider.token)).status).toBe(403);
      expect((await first('2026-09-12', JST, outsider.token)).status).toBe(403);
    });

    it('★ 形の違う引数は 400', async () => {
      expect((await days('2026-9')).status).toBe(400);
      expect((await days('abc')).status).toBe(400);
      expect((await first('2026-09-12x')).status).toBe(400);
      expect((await first('2026-13-01')).status).toBe(400);
      expect((await days('2026-09', 'x' as unknown as number)).status).toBe(400);
      expect((await days('2026-09', 5000)).status).toBe(400);   // 時差は ±14 時間まで
    });
  });
});
