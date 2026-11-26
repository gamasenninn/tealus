/**
 * 見張り room_quiet の「最後の投稿」の引き方 (docs/09)。2026-11-26 の語の絞り (content_contains) を DB で確かめる
 * ★ 同じ送り手が別の話も投稿する部屋で、決まった報告 (例:「BD 毎晩」) だけを数える
 */
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { lastPostAtFromRoom } from '../../src/services/watchdogRunner.mts';
import type { RoomQuietWatch } from '../../src/services/watchdogs.mts';

describe('lastPostAtFromRoom', () => {
  let room: string, sender: string, other: string;
  const base = (extra: Partial<RoomQuietWatch> = {}): RoomQuietWatch => ({
    id: 'bd', name: 'BD', kind: 'room_quiet', enabled: true, alert_after: 1, room_id: room, room: '業務メモ',
    from_user_ids: [sender], max_quiet_minutes: 1560, start_minute: 0, end_minute: 1440, days: [0, 1, 2, 3, 4, 5, 6], continuous: true, ...extra,
  } as RoomQuietWatch);

  beforeAll(async () => {
    await setupTestDb();
    await cleanTestDb();
    const pool = getTestPool();
    sender = (await createTestUser({ login_id: 'BKUP1', display_name: 'バックアップ' })).user.id;
    other = (await createTestUser({ login_id: 'OTHER1', display_name: '別の人' })).user.id;
    room = (await pool.query(`INSERT INTO rooms (name, type, created_by) VALUES ('業務メモ', 'group', $1) RETURNING id`, [sender])).rows[0].id;
    const post = (who: string, content: string, at: string, deleted = false) => pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content, created_at, is_deleted) VALUES ($1, $2, 'text', $3, $4, $5)`, [room, who, content, at, deleted]);
    await post(sender, '✅BD 毎晩 261125: 正 33/33 一致', '2026-11-25T12:04:00Z');
    await post(sender, 'ドライブを確かめました', '2026-11-26T03:00:00Z');                 // 別の話 (語を含まない)
    await post(other, '★BD 毎晩 261126: 失敗 (別の人)', '2026-11-26T04:00:00Z');        // 別の送り手
    await post(sender, '★BD 毎晩 261126 (消した)', '2026-11-26T05:00:00Z', true);        // 消した投稿
  });
  afterAll(async () => { await closeTestDb(); });

  it('語の絞りなし: その送り手の最後の投稿 (別の話も数える)', async () => {
    expect((await lastPostAtFromRoom(base()))?.toISOString()).toBe('2026-11-26T03:00:00.000Z');
  });

  it('★ 語の絞りあり: その語を含む、その送り手の、消していない投稿だけ', async () => {
    expect((await lastPostAtFromRoom(base({ content_contains: 'BD 毎晩' })))?.toISOString()).toBe('2026-11-25T12:04:00.000Z');
  });

  it('% や _ を含む語もそのまま探す (LIKE として読まない)', async () => {
    expect(await lastPostAtFromRoom(base({ content_contains: 'BD%' }))).toBeNull();
  });
});
