/**
 * 部屋を自分の一覧から隠す (#655, 2026-11-24)
 *
 * ★ 隠すのは自分の一覧からだけ。ほかの人の一覧・メッセージは変わらない。
 * ★ 隠した時刻より新しい投稿があれば、自動で一覧に戻る (LINE の「非表示」と同じ)。
 *   戻すための書き込みはしない: 一覧を作るときに「最後の投稿 <= 隠した時刻」を見るだけ。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('部屋を自分の一覧から隠す', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let me: TestUser, other: TestUser, outsider: TestUser, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    me = await createTestUser({ login_id: 'EMP001', display_name: '自分' });
    other = await createTestUser({ login_id: 'EMP002', display_name: '相手' });
    outsider = await createTestUser({ login_id: 'EMP003', display_name: 'よその人' });
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${me.token}`)
      .send({ name: '終わった仕事', member_ids: [other.user.id] });
    roomId = roomRes.body.room.id;
  });

  const listed = async (token: string) => {
    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.rooms.find((r: { id: string }) => r.id === roomId);
  };
  const hide = (token: string, hidden: unknown) =>
    request(app).put(`/api/rooms/${roomId}/hidden`).set('Authorization', `Bearer ${token}`).send({ hidden });
  // ★ 時刻の比較なので、同じミリ秒にならないよう投稿は「今より後」の時刻で入れる
  const postLater = async (senderId: string, seconds: number) => {
    await getTestPool().query(
      `INSERT INTO messages (room_id, sender_id, content, type, created_at)
       VALUES ($1, $2, 'あとから来た話', 'text', now() + make_interval(secs => $3))`,
      [roomId, senderId, seconds]);
  };

  it('既定は隠していない', async () => {
    expect((await listed(me.token)).is_hidden).toBe(false);
  });

  it('★ 隠すと自分の一覧でだけ隠れる (一覧からは消さず is_hidden で返す)。相手は変わらない', async () => {
    const res = await hide(me.token, true);
    expect(res.status).toBe(200);
    expect(res.body.is_hidden).toBe(true);
    expect((await listed(me.token)).is_hidden).toBe(true);
    expect((await listed(other.token)).is_hidden).toBe(false);
  });

  it('★★ 隠した後に新しい投稿が来たら自動で戻る (誰の投稿でも)', async () => {
    await hide(me.token, true);
    await postLater(other.user.id, 5);
    expect((await listed(me.token)).is_hidden).toBe(false);
  });

  it('隠す前の投稿だけなら隠れたまま', async () => {
    await postLater(other.user.id, -60);
    await hide(me.token, true);
    expect((await listed(me.token)).is_hidden).toBe(true);
  });

  it('削除された投稿では戻らない (一覧の「最後の投稿」と同じく数えない)', async () => {
    await hide(me.token, true);
    await postLater(other.user.id, 5);
    await getTestPool().query('UPDATE messages SET is_deleted = true WHERE room_id = $1', [roomId]);
    expect((await listed(me.token)).is_hidden).toBe(true);
  });

  it('戻せる', async () => {
    await hide(me.token, true);
    const res = await hide(me.token, false);
    expect(res.status).toBe(200);
    expect(res.body.is_hidden).toBe(false);
    expect((await listed(me.token)).is_hidden).toBe(false);
  });

  it('★ 戻った後にもう一度隠せる (隠した時刻を新しくする)', async () => {
    await hide(me.token, true);
    await postLater(other.user.id, 5);
    expect((await listed(me.token)).is_hidden).toBe(false);
    // 隠す時刻は今 (投稿は 5 秒後の時刻で入っている) なので、時刻をそれより後に進めて確かめる
    await hide(me.token, true);
    await getTestPool().query(
      `UPDATE room_members SET hidden_at = now() + interval '10 seconds' WHERE room_id = $1 AND user_id = $2`,
      [roomId, me.user.id]);
    expect((await listed(me.token)).is_hidden).toBe(true);
  });

  it('hidden が真偽値でなければ 400', async () => {
    expect((await hide(me.token, 'yes')).status).toBe(400);
  });

  it('メンバーでなければ 403', async () => {
    expect((await hide(outsider.token, true)).status).toBe(403);
  });
});
