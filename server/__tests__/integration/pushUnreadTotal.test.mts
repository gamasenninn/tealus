/**
 * 通知に載せる未読の合計 (バッジ用) の数え方を固定する (2026-09-28)
 *
 * ★ 数え方: 自分が入っているルームの、他人が送った・消されていない・既読位置より新しいメッセージ。
 *   既読位置が無いルームは全部を数える。
 * ★★ 集計を速く書き直した (本番の最大 539ms → 23ms)。書き直す前もこのテストは通る —— 挙動を変えていない証拠として置く。
 */
const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: {
  setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => mockSend(...a),
} }));

import { sendPushToUser } from '../../src/services/push.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('通知の未読合計', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  test('他人の・消されていない・既読より新しいメッセージだけを、入っているルームで数える', async () => {
    const pool = getTestPool();
    const me = (await createTestUser({ login_id: 'EMP001', display_name: '自分' })).user;
    const other = (await createTestUser({ login_id: 'EMP002', display_name: '相手' })).user;

    const room = async (name: string, members: string[]) => {
      const r = await pool.query<{ id: string }>(`INSERT INTO rooms (type, name) VALUES ('group', $1) RETURNING id`, [name]);
      for (const u of members) await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [r.rows[0].id, u]);
      return r.rows[0].id;
    };
    const msg = (roomId: string, sender: string, at: string, deleted = false) =>
      pool.query(`INSERT INTO messages (room_id, sender_id, content, type, is_deleted, created_at) VALUES ($1, $2, 'x', 'text', $3, $4)`,
        [roomId, sender, deleted, at]);

    // 既読位置あり: 既読より前 1 / 後 2 (うち 1 は消されている) / 自分の 1 → 数えるのは 1
    const read = await room('既読あり', [me.id, other.id]);
    await pool.query(`INSERT INTO room_read_cursors (room_id, user_id, last_read_at) VALUES ($1, $2, '2026-09-01T00:00:00Z')`, [read, me.id]);
    await msg(read, other.id, '2026-08-31T00:00:00Z');
    await msg(read, other.id, '2026-09-02T00:00:00Z');
    await msg(read, other.id, '2026-09-03T00:00:00Z', true);
    await msg(read, me.id, '2026-09-04T00:00:00Z');

    // 既読位置なし: 他人の 2 を全部数える
    const unread = await room('既読なし', [me.id, other.id]);
    await msg(unread, other.id, '2026-08-01T00:00:00Z');
    await msg(unread, other.id, '2026-09-05T00:00:00Z');

    // 入っていないルーム: 数えない
    const notMine = await room('よそ', [other.id]);
    await msg(notMine, other.id, '2026-09-06T00:00:00Z');

    await pool.query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES ($1, 'https://push.example/x', 'p', 'a')`, [me.id]);

    await sendPushToUser(me.id, { title: 't', body: 'b' });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSend.mock.calls[0][1]).total_unread).toBe(3);
  });
});
