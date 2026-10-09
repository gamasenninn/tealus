/**
 * #543 ID の形が壊れていても 500 にしない (400 で断る) / 壊れたスタンプで部屋の一覧を壊さない
 *
 * ★ 2026-10-09 の点検で: 部屋のメンバーの総当たり (outsiderSweep) は正しい形の ID で叩くので見えなかった。
 *   ID の形を確かめずに DB へ渡し、uuid への変換で落ちて 500 を返す口がいくつかあった
 * ★ スタンプは中身 (スタンプの ID) を確かめずに保存していたので、壊れた中身が 1 件入ると、
 *   その部屋の一覧を読むたびに全員 500 になった
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

const BAD = 'not-a-uuid';

describe('#543 壊れた ID', () => {
  let token: string;
  let roomId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const u = await createTestUser({ login_id: 'EMP001', display_name: '自分' });
    token = u.token;
    roomId = (await request(app).post('/api/rooms').set(auth()).send({ name: '部屋', member_ids: [] })).body.room.id;
  });

  it('★★ 壊れた中身のスタンプは 400 で断り、部屋の一覧は読める', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/messages`).set(auth()).send({ type: 'stamp', content: BAD });
    expect(res.status).toBe(400);
    const list = await request(app).get(`/api/rooms/${roomId}/messages`).set(auth());
    expect(list.status).toBe(200);
  });

  it('★ 存在しないスタンプも 400', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/messages`).set(auth())
      .send({ type: 'stamp', content: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(400);
  });

  it.each([
    ['GET', () => `/api/rooms/${roomId}/media?tag=${BAD}`, null],
    ['POST', () => `/api/rooms/${roomId}/media/forward`, { source_message_id: BAD }],
    ['GET', () => `/api/search?q=abc&tag_id=${BAD}`, null],
    ['GET', () => `/api/search?q=abc&room_id=${BAD}`, null],
    ['POST', () => `/api/rooms/${roomId}/members`, { user_id: BAD }],
    ['PUT', () => `/api/messages/${BAD}/transcription`, { text: 'x' }],
    ['GET', () => `/api/messages/${BAD}/transcription/history`, null],
    ['POST', () => `/api/messages/${BAD}/transcription/retranscribe`, {}],
    ['GET', () => `/api/bot/search?sender_id=${BAD}`, null],
  ] as Array<[string, () => string, object | null]>)('★ %s %s は 500 にしない', async (method, path, body) => {
    const r = request(app)[method.toLowerCase() as 'get' | 'post' | 'put'](path()).set(auth());
    const res = body ? await r.send(body) : await r;
    expect(res.status).toBeLessThan(500);
  });
});
