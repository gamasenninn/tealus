import { create } from 'zustand';
import { api } from '../services/api';
import { syncBadgeFromRooms } from '../services/appBadge';
import { getCachedRoomView, cacheRoomView, evictRoomView, isGoneFromRoom } from './roomViewCache';
import type { Room, RoomMember } from '../types';

/** #600 最後に開こうとした部屋。取りに行っている間に別の部屋へ移ったら、遅れて届いた応答を書かない */
let selecting: string | null = null;

interface RoomState {
  rooms: Room[];
  currentRoom: Room | null;
  members: RoomMember[];
  lastReadMessageId: string | null;
  error: string | null;
  fetchRooms: () => Promise<void>;
  /** ★ ログアウトで一覧・開いていた部屋を捨てる。走っている取り直しの応答も捨てる (改善ループ 16 回目) */
  reset: () => void;
  selectRoom: (roomId: string) => Promise<void>;
  /** #489 開いている部屋の情報とメンバーだけを取り直す (既読の位置は動かさない)。別の部屋なら何もしない */
  refreshRoom: (roomId: string) => Promise<void>;
  clearCurrentRoom: () => void;
  createGroup: (name: string, memberIds: string[]) => Promise<{ room: Room }>;
  createDirect: (partnerId: string) => Promise<{ room: Room }>;
  updateRoomInList: (roomId: string, updates: Partial<Room>) => void;
}

let roomsInflight: Promise<void> | null = null;
let roomsAgain = false;
/** reset のたびに進める。取り直しの応答は、出したときと同じ世代のときだけ入れる */
let roomsGeneration = 0;

export const useRoomStore = create<RoomState>()((set, get) => ({
  rooms: [],
  currentRoom: null,
  members: [],
  lastReadMessageId: null,
  error: null,

  reset: () => {
    roomsGeneration++;
    roomsAgain = false;
    set({ rooms: [], currentRoom: null, members: [], lastReadMessageId: null, error: null });
    syncBadgeFromRooms([]);
  },

  fetchRooms: () => {
    // ★ 走っている間に来た呼び出しはまとめ、終わった後に 1 回だけ取り直す (改善ループ 14 回目)。
    //   部屋を開く 1 操作で 2〜3 本重なっていた (既読の後・socket の知らせ・一覧の画面)。
    //   まとめた人も「呼んだ後の状態」を受け取れるよう、取り直しが終わってから解決する
    if (roomsInflight) { roomsAgain = true; return roomsInflight; }
    roomsInflight = (async () => {
      do {
        roomsAgain = false;
        const gen = roomsGeneration;
        try {
          const data = await api.getRooms();
          if (gen !== roomsGeneration) return;   // ★ 途中でログアウトした = 前の人の一覧なので捨てる
          set({ rooms: data.rooms, error: null });
          // PWA App Badge を foreground でも自動 sync (#badge SPIKE、5/12)
          syncBadgeFromRooms(data.rooms);
        } catch {
          if (gen !== roomsGeneration) return;
          set({ error: 'ルーム一覧の取得に失敗しました' });
        }
      } while (roomsAgain);
    })().finally(() => { roomsInflight = null; });
    return roomsInflight;
  },

  selectRoom: async (roomId) => {
    selecting = roomId;
    // ★ #600 別の部屋を開くときは、前に開いたときの見出し・メンバーを先に出す (取り直しが届くまで空にしない)。
    //   未読の区切り (lastReadMessageId) は出さない: 取り直した値で決める
    const cached = get().currentRoom?.id !== roomId ? getCachedRoomView(roomId) : undefined;
    if (cached) set({ currentRoom: cached.room, members: cached.members, lastReadMessageId: null });
    try {
      const data = await api.getRoom(roomId);
      if (selecting !== roomId) return;
      cacheRoomView(roomId, { room: data.room, members: data.members });
      set({ currentRoom: data.room, members: data.members, lastReadMessageId: data.last_read_message_id ?? null, error: null });
    } catch (err) {
      if (selecting !== roomId) return;
      // ★ #600 外された・消された部屋なら、覚えた見出しを捨てて画面からも消す
      if (isGoneFromRoom(err)) {
        evictRoomView(roomId);
        if (get().currentRoom?.id === roomId) set({ currentRoom: null, members: [], lastReadMessageId: null });
      }
      // ★ #592 理由を添える (以前は権限が無いのも圏外も同じ定型文だった。サーバの文・通信の案内は日本語)
      set({ error: `ルームを開けませんでした: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  refreshRoom: async (roomId) => {
    if (get().currentRoom?.id !== roomId) return;
    try {
      const data = await api.getRoom(roomId);
      // ★ 取りに行っている間に別の部屋へ移っていたら書かない
      if (get().currentRoom?.id !== roomId) return;
      cacheRoomView(roomId, { room: data.room, members: data.members });   // #600
      set({ currentRoom: data.room, members: data.members });
    } catch {
      // 取り直しに失敗しても今の表示は残す (次の変化か読み込み直しで追いつく)
    }
  },

  clearCurrentRoom: () => {
    set({ currentRoom: null, members: [], lastReadMessageId: null });
  },

  createGroup: async (name, memberIds) => {
    const data = await api.createGroup(name, memberIds);
    await get().fetchRooms();
    return data;
  },

  createDirect: async (partnerId) => {
    const data = await api.createDirect(partnerId);
    await get().fetchRooms();
    return data;
  },

  updateRoomInList: (roomId, updates) => {
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.id === roomId ? { ...r, ...updates } : r
      ),
    }));
  },
}));
