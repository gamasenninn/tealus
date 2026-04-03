import { create } from 'zustand';
import { api } from '../services/api';

export const useMessageStore = create((set, get) => ({
  messages: [],
  hasMore: true,
  isLoading: false,
  error: null,
  replyTo: null,

  fetchMessages: async (roomId, around = null) => {
    try {
      set({ isLoading: true, error: null });
      const data = await api.getMessages(roomId, null, 20, around);
      set({
        messages: around ? data.messages : data.messages.reverse(),
        hasMore: data.messages.length >= 20,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: 'メッセージの取得に失敗しました' });
    }
  },

  loadMore: async (roomId) => {
    const { messages, isLoading } = get();
    if (messages.length === 0 || isLoading) return;
    try {
      set({ isLoading: true });
      const oldestId = messages[0].id;
      const data = await api.getMessages(roomId, oldestId);
      set((state) => ({
        messages: [...data.messages.reverse(), ...state.messages],
        hasMore: data.messages.length >= 20,
        isLoading: false,
      }));
    } catch (err) {
      set({ isLoading: false, error: '過去メッセージの取得に失敗しました' });
    }
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

  updateReactions: (messageId, reactions) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, reactions } : m
      ),
    }));
  },

  updateLinkPreview: (messageId, preview) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, link_preview: preview } : m
      ),
    }));
  },

  markDeleted: (messageId) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, is_deleted: true, content: null } : m
      ),
    }));
  },

  updateTranscription: (messageId, transcription) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, transcription: { ...m.transcription, ...transcription } } : m
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
    set({ messages: [], hasMore: true, error: null, replyTo: null });
  },
}));
