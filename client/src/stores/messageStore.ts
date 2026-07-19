import { create } from 'zustand';
import { api } from '../services/api';
import type { Message, Reaction, LinkPreview, Transcription } from '../types';

// types.ts の Message には link_preview (単数、socket 'link:preview' で注入) が無いため local 拡張。
export type StoreMessage = Message & { link_preview?: LinkPreview | null };

interface MessageState {
  messages: StoreMessage[];
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  replyTo: Message | null;
  fetchMessages: (roomId: string, around?: string | null) => Promise<void>;
  loadMore: (roomId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  updateReadCount: (messageId: string, readCount: number) => void;
  updateReactions: (messageId: string, reactions: Reaction[]) => void;
  updateLinkPreview: (messageId: string, preview: LinkPreview | null) => void;
  markDeleted: (messageId: string) => void;
  updatePublishStatus: (messageId: string, isPublished: boolean) => void;
  updateMessageContent: (messageId: string, content: string | null, isEdited: boolean) => void;
  updateTranscription: (messageId: string, transcription: Partial<Transcription>) => void;
  setReplyTo: (message: Message | null) => void;
  clearReplyTo: () => void;
  // #338 Phase 1: 「エージェントに送る」等が composer に prefill する text を運ぶチャネル。
  // replyTo と同じ bubble/menu → composer の一方向。MessageInput が消費後に clear する。
  composerPrefill: string | null;
  setComposerPrefill: (text: string | null) => void;
  clearComposerPrefill: () => void;
  clearMessages: () => void;
}

export const useMessageStore = create<MessageState>()((set, get) => ({
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

  updatePublishStatus: (messageId, isPublished) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, is_published: isPublished } : m
      ),
    }));
  },

  updateMessageContent: (messageId, content, isEdited) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content, is_edited: isEdited } : m
      ),
    }));
  },

  updateTranscription: (messageId, transcription) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, transcription: { ...m.transcription, ...transcription } as Transcription } : m
      ),
    }));
  },

  setReplyTo: (message) => {
    set({ replyTo: message });
  },

  clearReplyTo: () => {
    set({ replyTo: null });
  },

  composerPrefill: null,
  setComposerPrefill: (text) => {
    set({ composerPrefill: text });
  },
  clearComposerPrefill: () => {
    set({ composerPrefill: null });
  },

  clearMessages: () => {
    set({ messages: [], hasMore: true, error: null, replyTo: null });
  },
}));
