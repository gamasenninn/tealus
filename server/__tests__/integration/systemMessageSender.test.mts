/**
 * system メッセージの送り主は「操作した本人」(2026-10-03)
 *
 * ★ それまでは部屋のメンバーを 1 人借りていた (`LIMIT 1`、誰になるかは決まらない)。
 *   本番の 377 件のうち 127 件が、本文に出てこない人の名前で記録されていた。
 *   画面は中央表示 (84b87db) で紛れないが、MCP・検索では「借りられた人がやった」と読める。
 *   さらに借りられた人は、送り主の判定を通るので REST で消せた。
 * ★ 本文の主語 (「A が B を追加しました」の A) を送り主にする。過去分は直さない (推測で書き換えない)。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('system メッセージの送り主', () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let actor: Awaited<ReturnType<typeof createTestUser>>;
  let target: Awaited<ReturnType<typeof createTestUser>>;
  let roomId: string;

  /** 部屋の最新の system メッセージ */
  const lastSystem = async (room: string) => {
    const r = await getTestPool().query<{ id: string; sender_id: string; content: string }>(
      `SELECT id, sender_id, content FROM messages WHERE room_id = $1 AND type = 'system'
       ORDER BY created_at DESC LIMIT 1`,
      [room]
    );
    return r.rows[0];
  };

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    // ★ 持ち主を最初のメンバーにしておく。借りる方式だと持ち主が選ばれやすく、
    //   操作した本人 (actor) と食い違うことで違いが見える
    owner = await createTestUser({ login_id: 'EMP841', display_name: '持ち主' });
    actor = await createTestUser({ login_id: 'EMP842', display_name: '操作する人' });
    target = await createTestUser({ login_id: 'EMP843', display_name: '対象の人' });
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '送り主の部屋', member_ids: [actor.user.id] })).body.room.id;
  });

  it('追加: 追加した人が送り主', async () => {
    await request(app).post(`/api/rooms/${roomId}/members`).set('Authorization', `Bearer ${actor.token}`)
      .send({ user_id: target.user.id }).expect(200);
    const m = await lastSystem(roomId);
    expect(m.content).toBe('操作する人が対象の人を追加しました');
    expect(m.sender_id).toBe(actor.user.id);
  });

  it('退会: 退会した人が送り主 (もうメンバーではないが、本文の主語は本人)', async () => {
    await request(app).delete(`/api/rooms/${roomId}/members/me`).set('Authorization', `Bearer ${actor.token}`).expect(200);
    const m = await lastSystem(roomId);
    expect(m.content).toBe('操作する人が退会しました');
    expect(m.sender_id).toBe(actor.user.id);
  });

  it('退会させる・管理者の変更: 操作した管理者が送り主', async () => {
    await request(app).put(`/api/rooms/${roomId}/members/${actor.user.id}/role`).set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'admin' }).expect(200);
    await request(app).post(`/api/rooms/${roomId}/members`).set('Authorization', `Bearer ${actor.token}`)
      .send({ user_id: target.user.id }).expect(200);

    await request(app).put(`/api/rooms/${roomId}/members/${target.user.id}/role`).set('Authorization', `Bearer ${actor.token}`)
      .send({ role: 'admin' }).expect(200);
    expect(await lastSystem(roomId)).toMatchObject({ content: '操作する人が対象の人をグループ管理者にしました', sender_id: actor.user.id });

    await request(app).put(`/api/rooms/${roomId}/members/${target.user.id}/role`).set('Authorization', `Bearer ${actor.token}`)
      .send({ role: 'member' }).expect(200);
    expect(await lastSystem(roomId)).toMatchObject({ content: '操作する人が対象の人のグループ管理者を解除しました', sender_id: actor.user.id });

    await request(app).delete(`/api/rooms/${roomId}/members/${target.user.id}`).set('Authorization', `Bearer ${actor.token}`).expect(200);
    expect(await lastSystem(roomId)).toMatchObject({ content: '操作する人が対象の人を退会させました', sender_id: actor.user.id });
  });

  it('ボットの参加: 入ったボットが送り主', async () => {
    const bot = await createTestUser({ login_id: 'BOT841', display_name: '入るボット' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    await request(app).post(`/api/bot/rooms/${roomId}/join`).set('Authorization', `Bearer ${bot.token}`).expect(200);
    expect(await lastSystem(roomId)).toMatchObject({ content: '入るボットが参加しました', sender_id: bot.user.id });
  });

  it('★ system メッセージは送り主本人でも消せない (編集と同じ扱い)', async () => {
    await request(app).post(`/api/rooms/${roomId}/members`).set('Authorization', `Bearer ${actor.token}`)
      .send({ user_id: target.user.id }).expect(200);
    const m = await lastSystem(roomId);

    // 送り主が誰になっていても消せないことを見る (直す前は借りられた人なら消せた)
    const sender = [owner, actor, target].find((u) => u.user.id === m.sender_id)!;
    const res = await request(app).delete(`/api/rooms/${roomId}/messages/${m.id}`).set('Authorization', `Bearer ${sender.token}`);
    // ★ 権限の問題ではなく「この種類は消せない」ので、編集と同じ 400 と文言で断る
    //   (「自分のメッセージのみ」と返すと、送り主本人や AI が理由を取り違える)
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('このメッセージは削除できません');

    const after = await getTestPool().query('SELECT is_deleted, content FROM messages WHERE id = $1', [m.id]);
    expect(after.rows[0]).toEqual({ is_deleted: false, content: '操作する人が対象の人を追加しました' });
  });
});
