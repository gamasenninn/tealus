/**
 * 部屋の履歴 (GET /api/rooms/:id/messages、routes/messages.mts) の SQL の組み立てと件数の丸め。
 * 改善ループ 128 で道から出した (中身は同じ。4 つの枝で同じだった SELECT を 1 つにした)。pool も logger も読まない純粋なファイル
 * テスト: __tests__/unit/roomMessagesQuery.test.mts (出す前の SQL と突き合わせ)、結合は messages など
 */
import { MESSAGES_DEFAULT_LIMIT, MESSAGES_MAX_LIMIT } from '../constants/config.mts';
import { parseLimit } from '../utils/queryLimit.mts';

export function parseRoomMessagesLimit(limit: unknown): number {
  return parseLimit(limit, MESSAGES_DEFAULT_LIMIT, MESSAGES_MAX_LIMIT);
}

/** 送った人の名前・顔と、既読の数 (送った人を除き、その投稿の時刻まで読んだ人) */
const SELECT = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
               COALESCE(rc.read_count, 0)::int AS read_count
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS read_count
          FROM room_read_cursors rrc
          WHERE rrc.room_id = m.room_id AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
        ) rc ON true
        WHERE m.room_id = $1`;

/** 基準は around > after > before の順で 1 つだけ使う。基準の ID の形は道で確かめる */
export function buildRoomMessagesQuery({ roomId, around, after, before, limit }: {
  roomId: string; around?: string; after?: string; before?: string; limit: number;
}): { query: string; params: unknown[] } {
  if (around) {
    // 検索で飛んだ先: 基準の 1 秒前から古い順に
    return {
      query: `${SELECT}
          AND m.created_at >= (SELECT created_at FROM messages WHERE id = $2 AND room_id = $1) - INTERVAL '1 second'
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT $3`,
      params: [roomId, around, limit],
    };
  }
  if (after) {
    // ★ #511 基準より新しいものを古い順に (日付・引用へ飛んだあと、下へ読み足す)。
    //   時刻だけで比べると、同じ時刻の投稿を取りこぼす → (時刻, id) の組で比べて、同じ順に並べる
    return {
      query: `${SELECT}
          AND (m.created_at, m.id) > (SELECT created_at, id FROM messages WHERE id = $2 AND room_id = $1)
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT $3`,
      params: [roomId, after, limit],
    };
  }
  if (before) {
    // 上へ読み足す: 基準より古いものを新しい順に。★ #664 after と同じく (時刻, id) の組で比べて並べる
    //   (時刻だけで切ると、同じ時刻の投稿がページの境目で落ちていた)
    return {
      query: `${SELECT}
          AND (m.created_at, m.id) < (SELECT created_at, id FROM messages WHERE id = $2 AND room_id = $1)
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3`,
      params: [roomId, before, limit],
    };
  }
  return {
    query: `${SELECT}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $2`,
    params: [roomId, limit],
  };
}
