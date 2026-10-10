/**
 * #564 会話モードでも、AI が読める部屋を「会話している人が入っている部屋」に絞る。
 *
 * ★ 会話モードは道具 (tealus-mcp) を agent-server の中で使い回す (毎回起動すると会話の立ち上がりが遅くなる)。
 *   そのため Light v2 のような依頼ごとの中継は使えず、/voice-chat/tool-call で道具を呼ぶ手前で絞る。
 * ★ 引けないときは**今の部屋だけ**にする (広げる側に倒さない)。
 * 設計: docs/03「AI が読める部屋は『頼んだ人が入っている部屋』だけ」
 */
type Db = { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

/** bot (login_id) と会話している人の両方が入っている部屋。引けなければ今の部屋だけ */
export async function requesterRoomIds(db: Db, botLoginId: string, userId: string, currentRoomId: string): Promise<Set<string>> {
  try {
    const { rows } = await db.query(
      `SELECT rm.room_id FROM room_members rm
         JOIN users b ON b.id = rm.user_id AND b.login_id = $1
        WHERE EXISTS (SELECT 1 FROM room_members ru WHERE ru.room_id = rm.room_id AND ru.user_id = $2)`,
      [botLoginId, userId]);
    return new Set(rows.map((r) => String(r.room_id)));
  } catch {
    return new Set([currentRoomId]);
  }
}

export type ScopeResult = { ok: true; args: Record<string, unknown> } | { ok: false; output: string };

/**
 * 道具の引数を絞る。部屋の ID の確かめ (resolveRoomArg) の手前で使う。
 * - 部屋の指定が無い検索 → 今の部屋に絞る (横断検索をしない)
 * - 投稿の ID → その投稿の部屋が知っている部屋でなければ、呼ばずに返す
 */
export async function scopeToolArgs(
  name: string,
  args: Record<string, unknown>,
  ctx: { currentRoomId: string; known: Set<string>; messageRoomOf: (messageId: string) => Promise<string | null> },
): Promise<ScopeResult> {
  if (name === 'search_messages' && typeof args.room_id !== 'string') {
    return { ok: true, args: { ...args, room_id: ctx.currentRoomId } };
  }
  if (typeof args.message_id === 'string') {
    const room = await ctx.messageRoomOf(args.message_id);
    if (room && room !== ctx.currentRoomId && !ctx.known.has(room)) {
      return { ok: false, output: 'その投稿は、会話している人が入っていないルームのものなので読めません。' };
    }
  }
  return { ok: true, args };
}

/** list_rooms の結果を、知っている部屋だけに減らす。読めない形なら空の一覧 */
export function filterListRooms(result: unknown, known: Set<string>): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  const empty = { content: [{ type: 'text', text: JSON.stringify({ rooms: [] }) }] };
  const idx = Array.isArray(content) ? content.findIndex((c) => c?.type === 'text') : -1;
  if (idx < 0) return empty;
  let parsed: unknown;
  try { parsed = JSON.parse(String(content![idx].text)); } catch { return empty; }
  const isArray = Array.isArray(parsed);
  const rooms = isArray ? parsed : (parsed as { rooms?: unknown })?.rooms;
  if (!Array.isArray(rooms)) return empty;
  const kept = rooms.filter((r) => known.has(String((r as { id?: unknown })?.id)));
  const text = JSON.stringify(isArray ? kept : { ...(parsed as object), rooms: kept });
  return { ...(result as object), content: content!.map((c, i) => (i === idx ? { ...c, text } : c)) };
}
