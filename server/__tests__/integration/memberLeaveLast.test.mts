/**
 * 最後の 1 人がグループを退会すると 500 になっていた (2026-10-01、部外者の総当たりで見つかった)
 *
 * ★ 原因: 「〜が退会しました」の system メッセージは、送り主に部屋の誰か 1 人を借りる。
 *   最後の 1 人が抜けた後は借りる人がいないので INSERT が not-null で落ち、
 *   **退会は済んでいるのに** 利用者には 500 が返っていた
 * ★ 直し方: 部屋に誰もいなければ system メッセージは入れない (見る人がいない)。退会は 200
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('最後の 1 人の退会', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); });

  // ★★ #536 (2026-10-09) 決まりを変えた: 最後の 1 人は退会できない (400)。「部屋を削除してください」と伝える。
  //   以前 (10-01) は 500 を直して「退会できる (200)」にしたが、空になった部屋は削除の口がメンバーにしか開いていないので
  //   誰も消せないまま残った (本番で 1 部屋)。1 人だけの部屋は、退会でなく削除で片づける
  it('★★ 1 人だけの部屋からは退会できない (400、部屋を削除するよう伝える)。メンバーのまま', async () => {
    const u = await createTestUser({ login_id: 'EMP501', display_name: 'ひとり' });
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${u.token}`)
      .send({ name: 'ひとりの部屋', member_ids: [] })).body.room.id;

    const res = await request(app).delete(`/api/rooms/${roomId}/members/me`).set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/削除/);
    const left = await getTestPool().query('SELECT 1 FROM room_members WHERE room_id = $1', [roomId]);
    expect(left.rowCount).toBe(1);
  });

  it('★ 1 人だけの部屋は、削除で片づけられる (前提の確認)', async () => {
    const u = await createTestUser({ login_id: 'EMP504', display_name: 'ひとり' });
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${u.token}`)
      .send({ name: 'ひとりの部屋', member_ids: [] })).body.room.id;
    const res = await request(app).delete(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBeLessThan(300);
  });

  it('2 人以上なら、これまでどおり「退会しました」が残る', async () => {
    const a = await createTestUser({ login_id: 'EMP502', display_name: '残る人' });
    const b = await createTestUser({ login_id: 'EMP503', display_name: '抜ける人' });
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: '二人の部屋', member_ids: [b.user.id] })).body.room.id;

    const res = await request(app).delete(`/api/rooms/${roomId}/members/me`).set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
    const sys = await getTestPool().query<{ content: string }>(
      `SELECT content FROM messages WHERE room_id = $1 AND type = 'system' AND content LIKE '%退会しました'`, [roomId]);
    expect(sys.rows.map((r) => r.content)).toEqual(['抜ける人が退会しました']);
  });
});
