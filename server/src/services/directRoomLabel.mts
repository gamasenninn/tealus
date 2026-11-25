/**
 * 1 対 1 の部屋の呼び名「A ↔ B」(部屋に名前が無いときに使う)。改善ループ 115 で 2 か所の組み立てを 1 つにした。
 * 使う所: webhook の payload の room.name (webhook.mts) と `@cc-` の受け箱の room_name (cc/ccIntake.mts)。
 * ★ 並びの順は決めていない (ORDER BY なし。まとめる前の 2 か所と同じ)。
 * ★ 管理画面の webhook 一覧 (routes/admin/webhooks.mts) は同じものを SQL の string_agg で作っている (1 本の SELECT の中なので、ここには寄せていない)。
 */
import { pool } from '../db/pool.mts';

export async function directRoomLabel(roomId: string): Promise<string | null> {
  const m = await pool.query<{ display_name: string }>(
    'SELECT u.display_name FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = $1', [roomId]);
  return m.rows.length > 0 ? m.rows.map((x) => x.display_name).join(' ↔ ') : null;
}
