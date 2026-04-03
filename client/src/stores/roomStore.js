import { create } from 'zustand';
import { api } from '../services/api';

export const useRoomStore = create((set, get) => ({
  rooms: [],
  currentRoom: null,
  members: [],
  error: null,

  fetchRooms: async () => {
    try {
      const data = await api.getRooms();
      set({ rooms: data.rooms, error: null });
    } catch (err) {
      set({ error: 'ルーム一覧の取得に失敗しました' });
    }
  },

  selectRoom: async (roomId) => {
    try {
      const data = await api.getRoom(roomId);
      set({ currentRoom: data.room, members: data.members, error: null });
    } catch (err) {
      set({ error: 'ルーム情報の取得に失敗しました' });
    }
  },

  clearCurrentRoom: () => {
    set({ currentRoom: null, members: [] });
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
