/**
 * #433 — 「エージェントの投稿では発火しない」を、構造で保証する。
 *
 * ★ #382 は外せない条件の 1 つ目にこう書いている:
 *     「エージェントの投稿では発火しない (ループが構造的に不可能になる)」
 *
 * ★★ ところが実装は sender を見ておらず、**いま成り立っているのは設定が `video` だけで、
 *   エージェントは text しか投げないから**だった。第 2 段 (出品写真 = `image`) を入れると、
 *   エージェントには画像を投稿する道具がある (`generate_and_send_image` / `send_image`) ので、
 *   ★★★ **AI が画像を 1 枚出したらトリガーが撃つ** —— 閉じたはずのループが開く。
 *
 * ★★★★ 実測 (2026-09-14): 本番のトリガー 2 ルームで、直近 60 日の video / image は
 *   **全部人間の投稿** (bot 0 件)。→ **除外を足しても今の挙動は変わらない**ことを確かめてから入れた。
 */
import { getTestPool } from '../helpers/db.mts';
import { latestMatchAtFromRoom } from '../../src/services/roomTriggerRunner.mts';
import type { RoomTrigger } from '../../src/services/roomTriggers.mts';

const ROOM = '00000000-0000-0000-0000-0000000004a1';
const HUMAN = '00000000-0000-0000-0000-0000000004a2';
const BOT = '00000000-0000-0000-0000-0000000004a3';

const trigger = (types: RoomTrigger['types']): RoomTrigger => ({
  id: 't-bot-exclusion', room_id: ROOM, room: 'テスト', types, when: 'immediate',
  message: 'x', as_user_id: HUMAN, enabled: true, description: '', quiet_minutes: 0,
});

describe('#433 トリガーは エージェントの投稿では発火しない', () => {
  const pool = getTestPool();

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO users (id, login_id, display_name, password_hash, is_bot)
       VALUES ($1,'h4a2','人間','x',false), ($2,'b4a3','エージェント','x',true)
       ON CONFLICT (id) DO NOTHING`,
      [HUMAN, BOT],
    );
    await pool.query(
      `INSERT INTO rooms (id, name, type) VALUES ($1,'トリガーテスト','group')
       ON CONFLICT (id) DO NOTHING`,
      [ROOM],
    );
    await pool.query('DELETE FROM messages WHERE room_id = $1', [ROOM]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM messages WHERE room_id = $1', [ROOM]);
    await pool.query('DELETE FROM rooms WHERE id = $1', [ROOM]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[HUMAN, BOT]]);
    await pool.end();
  });

  it('★ エージェント (is_bot) の画像は 発火の材料に数えない', async () => {
    await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content, created_at)
       VALUES ($1,$2,'image','AI が出した画像', now())`,
      [ROOM, BOT],
    );
    // ★ これが null でないと、AI の投稿がまた AI を起こす = ループが開く。
    expect(await latestMatchAtFromRoom(trigger(['image']))).toBeNull();
  });

  it('人の画像は これまでどおり数える', async () => {
    await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content, created_at)
       VALUES ($1,$2,'image','人が出した画像', now())`,
      [ROOM, HUMAN],
    );
    expect(await latestMatchAtFromRoom(trigger(['image']))).not.toBeNull();
  });

  it('★★ 人の投稿より後に AI が投稿しても、時刻は人の方のまま', async () => {
    // ★ ここが本番の形。AI が撃たれて画像を返した瞬間に「新しい材料が来た」と読むと、
    //   前回発火より後になって **もう一度撃つ**。
    const { rows } = await pool.query<{ at: Date }>(
      `INSERT INTO messages (room_id, sender_id, type, content, created_at)
       VALUES ($1,$2,'image','AI の返信画像', now() + interval '1 hour') RETURNING created_at AS at`,
      [ROOM, BOT],
    );
    const latest = await latestMatchAtFromRoom(trigger(['image']));
    expect(latest).not.toBeNull();
    expect(latest!.getTime()).toBeLessThan(rows[0].at.getTime());
  });

  it('削除された投稿は これまでどおり数えない', async () => {
    await pool.query('UPDATE messages SET is_deleted = true WHERE room_id = $1 AND sender_id = $2', [ROOM, HUMAN]);
    expect(await latestMatchAtFromRoom(trigger(['image']))).toBeNull();
  });
});
