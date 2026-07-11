import { create } from 'zustand';
import { api } from '../services/api';
import { syncBadgeFromRooms } from '../services/appBadge';
import type { Room, RoomMember } from '../types';

interface RoomState {
  rooms: Room[];
  currentRoom: Room | null;
  members: RoomMember[];
  lastReadMessageId: string | null;
  error: string | null;
  fetchRooms: () => Promise<void>;
  selectRoom: (roomId: string) => Promise<void>;
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
    try {
      const data = await api.getRoom(roomId);
      set({ currentRoom: data.room, members: data.members, lastReadMessageId: data.last_read_message_id ?? null, error: null });
    } catch {
      set({ error: 'ルーム情報の取得に失敗しました' });
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
