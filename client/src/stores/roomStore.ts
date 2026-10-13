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
  selectRoom: (roomId: string) => Promise<void>;
  /** #489 開いている部屋の情報とメンバーだけを取り直す (既読の位置は動かさない)。別の部屋なら何もしない */
  refreshRoom: (roomId: string) => Promise<void>;
  clearCurrentRoom: () => void;
  createGroup: (name: string, memberIds: string[]) => Promise<{ room: Room }>;
  createDirect: (partnerId: string) => Promise<{ room: Room }>;
  updateRoomInList: (roomId: string, updates: Partial<Room>) => void;
}

export const useRoomStore = create<RoomState>()((set, get) => ({
  rooms: [],
  currentRoom: null,
  members: [],
  lastReadMessageId: null,
  error: null,

  fetchRooms: async () => {
    try {
      const data = await api.getRooms();
      set({ rooms: data.rooms, error: null });
      // PWA App Badge を foreground でも自動 sync (#badge SPIKE、5/12)
      syncBadgeFromRooms(data.rooms);
    } catch {
      set({ error: 'ルーム一覧の取得に失敗しました' });
    }
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
