/**
 * #601 削除した投稿の添付ファイルは開けなくする (ファイルは残す)。
 *
 * ★ 以前: 投稿を削除しても、/media のアドレスを知っていれば添付を開けた (本番で 40 件)
 * ★★ 転送は同じファイルを共有する。「削除された投稿に付いている」だけで隠すと、転送先の
 *   生きている投稿の添付まで開けなくなる (本番で 2 本該当)。→ 使っている投稿が **全部** 削除されたときだけ隠す
 */
import { setupTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { isMediaHidden } from '../../src/services/deletedMedia.mts';

let roomId: string;
let userId: string;

async function post(isDeleted: boolean, filePath: string, thumb: string | null = null): Promise<void> {
  const db = getTestPool();
  const { rows: [m] } = await db.query<{ id: string }>(
    `INSERT INTO messages (room_id, sender_id, type, is_deleted) VALUES ($1, $2, 'image', $3) RETURNING id`,
    [roomId, userId, isDeleted],
  );
  await db.query(
    `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, thumbnail_path)
     VALUES ($1, $2, 'x.png', 'image/png', 1, $3)`,
    [m.id, filePath, thumb],
  );
}

beforeAll(async () => {
  await setupTestDb();
  const { user } = await createTestUser();
  userId = user.id;
  const { rows: [r] } = await getTestPool().query<{ id: string }>(
    `INSERT INTO rooms (type, name, created_by) VALUES ('group', '601', $1) RETURNING id`, [userId]);
  roomId = r.id;
  await post(true, 'images/only-deleted.png', 'thumbnails/only-deleted.jpg');
  await post(true, 'images/forwarded.png');
  await post(false, 'images/forwarded.png');   // 転送の写し (同じファイル) は生きている
  await post(false, 'images/live.png', 'thumbnails/live.jpg');
});
afterAll(async () => { await closeTestDb(); });

describe('isMediaHidden (#601)', () => {
  it('★★ 削除した投稿だけが使っていた添付は隠す (サムネイルも)', async () => {
    expect(await isMediaHidden('images/only-deleted.png', getTestPool())).toBe(true);
    expect(await isMediaHidden('thumbnails/only-deleted.jpg', getTestPool())).toBe(true);
  });

  it('★★ 転送先の投稿が生きている添付は隠さない', async () => {
    expect(await isMediaHidden('images/forwarded.png', getTestPool())).toBe(false);
  });

  it('生きている投稿の添付は隠さない', async () => {
    expect(await isMediaHidden('images/live.png', getTestPool())).toBe(false);
    expect(await isMediaHidden('thumbnails/live.jpg', getTestPool())).toBe(false);
  });

  it('★ 表に載っていないファイル (アイコン・スタンプ) は隠さない', async () => {
    expect(await isMediaHidden('avatars/someone.png', getTestPool())).toBe(false);
  });

  it('★ 配信のたびに引くので、file_path と thumbnail_path に索引がある', async () => {
    const { rows } = await getTestPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'message_media'`);
    const defs = rows.map((r) => r.indexdef).join('\n');
    expect(defs).toMatch(/\(file_path\)/);
    expect(defs).toMatch(/\(thumbnail_path\)/);
  });
});

/**
 * #602 部屋を削除すると messages / message_media が CASCADE で行ごと消え、上の判定 (行があって全部削除) に
 * 引っかからなかった。消す前に「消した添付」として記録し、生きている投稿が使っていなければ隠す
 */
describe('部屋を削除したときの添付 (#602)', () => {
  let token: string;
  let creatorId: string;

  async function roomWith(name: string): Promise<string> {
    const res = await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`).send({ name, member_ids: [] });
    return res.body.room.id;
  }
  async function attach(room: string, filePath: string, thumb: string | null = null): Promise<void> {
    const db = getTestPool();
    const { rows: [m] } = await db.query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'image') RETURNING id`, [room, creatorId]);
    await db.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, thumbnail_path)
       VALUES ($1, $2, 'x.png', 'image/png', 1, $3)`, [m.id, filePath, thumb]);
  }

  beforeAll(async () => {
    const u = await createTestUser();
    token = u.token;
    creatorId = u.user.id;
  });

  it('★★ 削除した部屋だけが使っていた添付 (サムネイルも) は隠す', async () => {
    const room = await roomWith('602-消す');
    await attach(room, 'images/602-gone.png', 'thumbnails/602-gone.jpg');
    expect(await isMediaHidden('images/602-gone.png', getTestPool())).toBe(false);
    const res = await request(app).delete(`/api/rooms/${room}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await isMediaHidden('images/602-gone.png', getTestPool())).toBe(true);
    expect(await isMediaHidden('thumbnails/602-gone.jpg', getTestPool())).toBe(true);
  });

  it('★★ 別の部屋に転送の写しが生きている添付は隠さない', async () => {
    const gone = await roomWith('602-消す2');
    const keep = await roomWith('602-残す');
    await attach(gone, 'images/602-shared.png');
    await attach(keep, 'images/602-shared.png');
    await request(app).delete(`/api/rooms/${gone}`).set('Authorization', `Bearer ${token}`);
    expect(await isMediaHidden('images/602-shared.png', getTestPool())).toBe(false);
  });
});
