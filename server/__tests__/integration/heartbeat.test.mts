/**
 * 鼓動の口 POST /api/bot/heartbeat (#595、docs/09 §3.2)
 *
 * ★ Tealus の部品 (tealus-cli など) が「生きている」を送る。本体は**送った人と名前の組**ごとに 1 行だけ覚える (上書き)。
 * ★ 部屋には何も流れない (知らせではない)。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { getHeartbeat } from '../../src/services/heartbeats.mts';

describe('POST /api/bot/heartbeat', () => {
  let bot: { user: { id: string }; token: string };
  let other: { user: { id: string }; token: string };

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    bot = await createTestUser({ login_id: 'BOT001', display_name: '送り込み' });
    other = await createTestUser({ login_id: 'BOT002', display_name: '別の部品' });
  });

  const beat = (token: string, body: unknown) =>
    request(app).post('/api/bot/heartbeat').set('Authorization', `Bearer ${token}`).send(body as object);

  it('名前と info を覚える。送った人の id と組にする', async () => {
    const info = { latest_file_at: '2026-10-13T03:00:00.000Z', last_sent_at: '2026-10-13T03:00:00.000Z' };
    const res = await beat(bot.token, { name: 'radio-sender', info });
    expect(res.status).toBe(200);
    const hb = await getHeartbeat(bot.user.id, 'radio-sender');
    expect(hb?.info).toEqual(info);
    expect(Date.now() - hb!.last_seen.getTime()).toBeLessThan(10_000);
  });

  it('★ 同じ人・同じ名前は上書き (1 行のまま増えない)', async () => {
    await beat(bot.token, { name: 'radio-sender', info: { n: 1 } });
    await beat(bot.token, { name: 'radio-sender', info: { n: 2 } });
    const { rows } = await getTestPool().query('SELECT info FROM heartbeats WHERE user_id = $1', [bot.user.id]);
    expect(rows).toEqual([{ info: { n: 2 } }]);
  });

  it('★ 別の人が同じ名前で送っても、他人の鼓動にはならない', async () => {
    await beat(other.token, { name: 'radio-sender' });
    expect(await getHeartbeat(bot.user.id, 'radio-sender')).toBeNull();
    expect(await getHeartbeat(other.user.id, 'radio-sender')).not.toBeNull();
  });

  it('info は省略できる', async () => {
    expect((await beat(bot.token, { name: 'x' })).status).toBe(200);
    expect((await getHeartbeat(bot.user.id, 'x'))?.info).toEqual({});
  });

  it.each([
    ['名前が無い', {}],
    ['名前が空', { name: '' }],
    ['名前に使えない文字', { name: 'radio sender/1' }],
    ['名前が長すぎる', { name: 'a'.repeat(65) }],
    ['info がオブジェクトでない', { name: 'x', info: 'text' }],
    ['info が大きすぎる', { name: 'x', info: { s: 'a'.repeat(5000) } }],
  ])('%s なら 400 で理由を返す', async (_label, body) => {
    const res = await beat(bot.token, body);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('ログインしていなければ 401', async () => {
    const res = await request(app).post('/api/bot/heartbeat').send({ name: 'x' });
    expect(res.status).toBe(401);
  });
});
