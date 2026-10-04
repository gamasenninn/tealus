/**
 * LINE の ID → Tealus の投稿の記録と引き当て (#490)
 *
 * ★ LINE の引用返信は引用元の ID (quotedMessageId) だけを送ってくる。本文は来ない。
 *   届いた便を記録しておき、引用が来たら同じ部屋の記録から引き当てて reply_to にする。
 *
 * ★ 記録・引き当ての失敗で投稿を止めないのは呼び出し側 (routes/line.mts) の責任。ここは素直に throw する。
 *
 * @module services/lineMessageLinks
 */
import { pool } from '../db/pool.mts';

/**
 * LINE の便の ID を Tealus の投稿に結びつける。
 * 画像のまとめ投稿は束の全部の ID を同じ 1 投稿へ。LINE の再送で同じ ID が来ても落ちない。
 */
export async function recordLineMessageLinks(
  { lineMessageIds, messageId, roomId }: { lineMessageIds: string[]; messageId: string; roomId: string }
): Promise<void> {
  const ids = lineMessageIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return;
  await pool.query(
    `INSERT INTO line_message_links (line_message_id, message_id, room_id)
     SELECT unnest($1::text[]), $2, $3
     ON CONFLICT (line_message_id) DO NOTHING`,
    [ids, messageId, roomId]
  );
}

/**
 * LINE の ID から、同じ部屋の Tealus の投稿 ID を引く。
 * 記録に無い・別の部屋・削除済みは null (= 引用元なしの扱い)。
 */
export async function findLinkedMessageId(lineMessageId: string, roomId: string): Promise<string | null> {
  const r = await pool.query<{ message_id: string }>(
    `SELECT l.message_id
     FROM line_message_links l
     JOIN messages m ON m.id = l.message_id
     WHERE l.line_message_id = $1 AND l.room_id = $2 AND m.is_deleted = false`,
    [lineMessageId, roomId]
  );
  return r.rows[0]?.message_id ?? null;
}
