/**
 * #477 会話モードの道具に渡る room_id を扱う (docs/08 §12.3)。
 *
 * ★ AI は list_rooms の 36 文字の ID を写してから道具を呼ぶ。2026-09-29 に 2 つの部屋の ID を
 *   前後でつないだ ID を作り、本体の 403「メンバーではありません」を「権限がない」と受け取って答え続けた。
 * ★ いまの部屋は "current" で指せるようにする。参加していない ID は、呼ばずに正直に返す。
 * ★★ 間違った ID を黙って今の部屋に置き換えない (別の部屋のつもりなら、違う部屋の中身で答えてしまう)。
 */

export const CURRENT_ROOM = 'current';

export type RoomArgResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; output: string };

/**
 * @param known アシスタントが参加しているルームの ID。null = 確かめられない (そのときは通す = 止めない)
 */
export function resolveRoomArg(
  name: string,
  args: Record<string, unknown>,
  currentRoomId: string,
  currentRoomName: string,
  known: Set<string> | null,
): RoomArgResult {
  const roomId = args.room_id;
  if (typeof roomId !== 'string') return { ok: true, args };
  if (roomId === CURRENT_ROOM) return { ok: true, args: { ...args, room_id: currentRoomId } };
  // join_room は参加していない部屋に入るための道具なので確かめない
  if (roomId === currentRoomId || name === 'join_room' || !known || known.has(roomId)) return { ok: true, args };
  return {
    ok: false,
    output: `room_id「${roomId}」のルームは、アシスタントが参加しているルームにありません`
      + ` (ID の写し間違いか、参加していないルームです)。`
      + `いまのルーム (${currentRoomName}) のことなら、room_id に "${CURRENT_ROOM}" を渡してください。`
      + `ほかのルームなら list_rooms の ID をそのまま使ってください。`,
  };
}

/** list_rooms の結果から、参加しているルームの ID を取り出す。読めなければ null */
export function roomIdsFromListRooms(result: unknown): Set<string> | null {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  const text = Array.isArray(content) ? content.find((c) => c?.type === 'text')?.text : undefined;
  if (typeof text !== 'string') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  const rooms = Array.isArray(parsed) ? parsed : (parsed as { rooms?: unknown })?.rooms;
  if (!Array.isArray(rooms)) return null;
  const ids = new Set<string>();
  for (const r of rooms) {
    const id = (r as { id?: unknown })?.id;
    if (typeof id === 'string') ids.add(id);
  }
  return ids.size > 0 ? ids : null;
}
