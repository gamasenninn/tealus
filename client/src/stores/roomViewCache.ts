import type { Room, RoomMember } from '../types';
import type { StoreMessage } from './messageStore';

/**
 * #600 トークを開いたときに先に出す「前に開いたときの中身」。
 *
 * ★ 覚える場所は画面を開いている間だけ (メモリ)。端末 (localStorage 等) には書き残さない —
 *   共用の端末に会話が残るのを避けるため。読み込み直す・ログアウトすると消える
 * ★ 写真・音声そのものは入れない (投稿が持っているのは URL だけ)
 * ★ 出すのは取り直しが届くまでのつなぎ。届いたら置き換える (messageStore.fetchMessages / roomStore.selectRoom)
 */

/** 覚えておく部屋の数。最近開いた順に残す (本番の最新 20 件で 1 室 8〜40KB、30 室で 1MB 前後) */
const MAX_ROOMS = 30;
/** 部屋ごとに覚える投稿の数 (開いたときに取る件数と同じ) */
export const MESSAGES_PER_ROOM = 20;

interface RoomView { room: Room; members: RoomMember[] }

const messagesByRoom = new Map<string, StoreMessage[]>();
const viewsByRoom = new Map<string, RoomView>();
/**
 * #600 監査 A: 外された・消された部屋。開いたまま外されると、捨てた直後に画面を閉じる処理 (clearMessages) が
 *   同じ 20 件を覚え直していた。ここに入っている間は覚えない。開け直せたら (markRoomReachable) 外す
 */
const goneRooms = new Set<string>();

/** 入れ直して「最近」にし、上限を超えた古い部屋から落とす */
function put<T>(map: Map<string, T>, roomId: string, value: T): void {
  map.delete(roomId);
  map.set(roomId, value);
  while (map.size > MAX_ROOMS) map.delete(map.keys().next().value as string);
}

export function getCachedMessages(roomId: string): StoreMessage[] | undefined {
  return messagesByRoom.get(roomId);
}

export function cacheMessages(roomId: string, messages: StoreMessage[]): void {
  if (messages.length === 0 || goneRooms.has(roomId)) return;
  put(messagesByRoom, roomId, messages.slice(-MESSAGES_PER_ROOM));
}

export function getCachedRoomView(roomId: string): RoomView | undefined {
  return viewsByRoom.get(roomId);
}

export function cacheRoomView(roomId: string, view: RoomView): void {
  markRoomReachable(roomId);   // 部屋の情報を取れた = 入れている
  put(viewsByRoom, roomId, view);
}

/** 外された・消された部屋の分を捨てる */
export function evictRoomView(roomId: string): void {
  goneRooms.add(roomId);
  messagesByRoom.delete(roomId);
  viewsByRoom.delete(roomId);
}

/** 本体から中身を取れた (招き直された等)。また覚えてよい */
export function markRoomReachable(roomId: string): void {
  goneRooms.delete(roomId);
}

/** ログアウト・ログインで全部捨てる (同じ画面で別の人がログインしても前の人の会話を出さない) */
export function clearRoomViewCache(): void {
  messagesByRoom.clear();
  viewsByRoom.clear();
  goneRooms.clear();
}

/** 本体が「その部屋に入れない」と答えたか (外された 403 / 消された 404)。圏外などでは捨てない */
export function isGoneFromRoom(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 403 || status === 404;
}

// 部屋から外れた知らせ (services/socket.ts が room:removed を変えて流す)。開いていない部屋でも捨てる
if (typeof window !== 'undefined') {
  window.addEventListener('tealus:room-removed', (e: Event) => {
    const roomId = (e as CustomEvent<{ room_id?: string }>).detail?.room_id;
    if (roomId) evictRoomView(roomId);
  });
}
