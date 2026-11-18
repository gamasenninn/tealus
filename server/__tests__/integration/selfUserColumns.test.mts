/**
 * 自分の利用者情報の列を 1 か所に (改善ループ 73、#649 B-7)
 *
 * ★ #532 (10-09) はログインの返事にだけ notification_sound が無く、入り直した直後の画面が「鳴らす」と見なした。
 *   同じ形が残っていて、is_bot は /me にあり、ログインと登録の返事に無かった
 *   (画面の client/src/utils/permissions.ts が読む)。3 つの口が同じ列を返すことを固定する
 */
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';

describe('自分の利用者情報: ログイン・登録・/me が同じ列を返す', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); });

  it('★ 登録・ログイン・/me の user の鍵が同じ (password_hash は無い)', async () => {
    const reg = await request(app).post('/api/auth/register').send({ login_id: 'first', password: 'password123', display_name: '最初の人' });
    expect(reg.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ login_id: 'first', password: 'password123' });
    expect(login.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    const meUser = me.body.user ?? me.body;
    const keys = (o: object) => Object.keys(o).filter((k) => !['push_active_subscriptions', 'push_had_subscriptions'].includes(k)).sort();
    expect(keys(login.body.user)).toEqual(keys(meUser));
    expect(keys(reg.body.user)).toEqual(keys(meUser));
    expect(login.body.user).not.toHaveProperty('password_hash');
    expect(login.body.user).toHaveProperty('is_bot', false);
  });

  it('★ 3 つの口は同じ定数の列を使う', () => {
    const SRC = path.join(import.meta.dirname, '../../src');
    for (const rel of ['middleware/auth.mts', 'routes/auth.mts']) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /SELF_USER_COLUMNS/.test(text)]).toEqual([rel, true]);
      expect([rel, /SELECT id, login_id, display_name/.test(text)]).toEqual([rel, false]);
    }
  });
});
