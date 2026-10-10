/**
 * #553 「すべて既読」は既読の位置を戻さない (ほかの 3 つの口と同じく新しいほうを残す)。
 * ★ 以前はそのまま上書きしていて、別の端末がより先まで読んだ直後だと位置が戻り、未読が復活しえた
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

test('★ 既読の位置が最新の投稿より先にあっても、「すべて既読」で戻らない', async () => {
  await setupTestDb();
  try {
    await cleanTestDb();
    const a = await createTestUser({ login_id: 'EMP5531', display_name: 'A' });
    const b = await createTestUser({ login_id: 'EMP5532', display_name: 'B' });
    const roomId = (await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${a.token}`)
      .send({ partner_id: b.user.id })).body.room.id;
    await request(app).post(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content: 'x' });
    // 別の端末がより先まで読んだ状態 (「すべて既読」が最新を読んだあと・書く前に入った既読)
    const ahead = new Date(Date.now() + 60_000);
    await getTestPool().query(
      `INSERT INTO room_read_cursors (room_id, user_id, last_read_at) VALUES ($1, $2, $3)`,
      [roomId, b.user.id, ahead]);
    const res = await request(app).post(`/api/rooms/${roomId}/read/all`).set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
    const { rows } = await getTestPool().query(
      'SELECT last_read_at FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [roomId, b.user.id]);
    expect(new Date(rows[0].last_read_at).getTime()).toBe(ahead.getTime());
  } finally {
    await closeTestDb();
  }
});
