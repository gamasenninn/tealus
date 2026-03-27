import { create } from 'zustand';
import { api } from '../services/api';

export const useRoomStore = create((set, get) => ({
  rooms: [],
  currentRoom: null,
  members: [],

  fetchRooms: async () => {
    const data = await api.getRooms();
    set({ rooms: data.rooms });
  },

  selectRoom: async (roomId) => {
    const data = await api.getRoom(roomId);
    set({ currentRoom: data.room, members: data.members });
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
