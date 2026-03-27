import { create } from 'zustand';
import { api } from '../services/api';

export const useMessageStore = create((set, get) => ({
  messages: [],
  hasMore: true,
  isLoading: false,
  replyTo: null,

  fetchMessages: async (roomId) => {
    set({ isLoading: true });
    const data = await api.getMessages(roomId);
    set({
      messages: data.messages.reverse(), // API returns newest first, we want oldest first
      hasMore: data.messages.length >= 20,
      isLoading: false,
    });
  },

  loadMore: async (roomId) => {
    const { messages } = get();
    if (messages.length === 0) return;
    const oldestId = messages[0].id;
    const data = await api.getMessages(roomId, oldestId);
    set((state) => ({
      messages: [...data.messages.reverse(), ...state.messages],
      hasMore: data.messages.length >= 20,
    }));
  },

  addMessage: (message) => {
    set((state) => {
      // Avoid duplicates
      if (state.messages.some((m) => m.id === message.id)) return state;
      return { messages: [...state.messages, message] };
    });
  },

  updateReadCount: (messageId, readCount) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, read_count: readCount } : m
      ),
    }));
  },

  setReplyTo: (message) => {
    set({ replyTo: message });
  },

  clearReplyTo: () => {
    set({ replyTo: null });
  },

  clearMessages: () => {
    set({ messages: [], hasMore: true, replyTo: null });
  },
}));
