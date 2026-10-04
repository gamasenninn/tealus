/**
 * #490 LINE の ID → Tealus の投稿の記録と引き当て
 *
 * ★ LINE の引用返信は引用元の ID (quotedMessageId) しか送らない。届いた便を記録しておかないと引き当てられない
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { recordLineMessageLinks, findLinkedMessageId } from '../../src/services/lineMessageLinks.mts';

describe('lineMessageLinks (#490)', () => {
  let roomA: string;
  let roomB: string;
  let msgA: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const u = await createTestUser({ login_id: 'EMP490', display_name: 'LINE Bridge' });
    const mk = async (name: string) => (await request(app).post('/api/rooms')
      .set('Authorization', `Bearer ${u.token}`).send({ name, member_ids: [] })).body.room.id as string;
    roomA = await mk('A');
    roomB = await mk('B');
    msgA = (await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '元の投稿', 'text') RETURNING id`,
      [roomA, u.user.id])).rows[0].id;
  });

  it('記録した LINE の ID から、同じ部屋の投稿を引き当てる', async () => {
    await recordLineMessageLinks({ lineMessageIds: ['L1'], messageId: msgA, roomId: roomA });
    expect(await findLinkedMessageId('L1', roomA)).toBe(msgA);
  });

  it('記録に無い ID は null', async () => {
    expect(await findLinkedMessageId('nope', roomA)).toBeNull();
  });

  it('★ 別の部屋からは引き当てない', async () => {
    await recordLineMessageLinks({ lineMessageIds: ['L1'], messageId: msgA, roomId: roomA });
    expect(await findLinkedMessageId('L1', roomB)).toBeNull();
  });

  it('束 (画像のまとめ投稿) の各 ID が同じ投稿を指す', async () => {
    await recordLineMessageLinks({ lineMessageIds: ['La', 'Lb'], messageId: msgA, roomId: roomA });
    expect(await findLinkedMessageId('La', roomA)).toBe(msgA);
    expect(await findLinkedMessageId('Lb', roomA)).toBe(msgA);
  });

  it('同じ ID を 2 回記録しても落ちない (LINE の再送)', async () => {
    await recordLineMessageLinks({ lineMessageIds: ['L1'], messageId: msgA, roomId: roomA });
    await expect(recordLineMessageLinks({ lineMessageIds: ['L1'], messageId: msgA, roomId: roomA })).resolves.toBeUndefined();
  });

  it('★ 削除済みの投稿は引き当てない', async () => {
    await recordLineMessageLinks({ lineMessageIds: ['L1'], messageId: msgA, roomId: roomA });
    await getTestPool().query(`UPDATE messages SET is_deleted = true WHERE id = $1`, [msgA]);
    expect(await findLinkedMessageId('L1', roomA)).toBeNull();
  });
});
