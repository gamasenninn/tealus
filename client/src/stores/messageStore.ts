import { create } from 'zustand';
import { api } from '../services/api';
import { patchMessage, patchQuotes } from './patchMessage';
import type { Message, MessageTag, Reaction, LinkPreview, Transcription } from '../types';

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
  /** #496 投稿のタグを丸ごと差し替える (message:tags の知らせ) */
  updateTags: (messageId: string, tags: MessageTag[]) => void;
  /** #496 消された部屋のタグを全投稿から外す (room:tag_deleted の知らせ) */
  removeTag: (tagId: string) => void;
  updateLinkPreview: (messageId: string, preview: LinkPreview | null) => void;
  markDeleted: (messageId: string) => void;
  updatePublishStatus: (messageId: string, isPublished: boolean) => void;
  updateMessageContent: (messageId: string, content: string | null, isEdited: boolean) => void;
  updateTranscription: (messageId: string, transcription: Partial<Transcription>) => void;
  setReplyTo: (message: Message | null) => void;
  clearReplyTo: () => void;
  // #338 Phase 1: 「エージェントに送る」の対象メッセージを composer へ運ぶチャネル。
  // MessageInput が消費し、宛先(アシスタント/cc-*)の決定・本文引き上げ・prefill を担う
  // (宛先選択が admin で必要なため、prefill 済み文字列でなく Message を渡す)。
  pendingAgentMessage: Message | null;
  setPendingAgentMessage: (message: Message | null) => void;
  clearPendingAgentMessage: () => void;
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
    set((state) => ({ messages: patchMessage(state.messages, messageId, { read_count: readCount }) }));
  },

  updateReactions: (messageId, reactions) => {
    set((state) => ({ messages: patchMessage(state.messages, messageId, { reactions }) }));
  },

  updateTags: (messageId, tags) => {
    set((state) => ({ messages: patchMessage(state.messages, messageId, { tags }) }));
  },

  removeTag: (tagId) => {
    set((state) => ({
      messages: state.messages.map((m) => (m.tags?.some((t) => (t.id ?? t.tag_id) === tagId)
        ? { ...m, tags: m.tags.filter((t) => (t.id ?? t.tag_id) !== tagId) }
        : m)),
    }));
  },

  updateLinkPreview: (messageId, preview) => {
    set((state) => ({ messages: patchMessage(state.messages, messageId, { link_preview: preview }) }));
  },

  markDeleted: (messageId) => {
    // ★ #501 引用している側の写しも消す (開いたままの画面に消した本文が残っていた)
    set((state) => ({
      messages: patchQuotes(
        patchMessage(state.messages, messageId, { is_deleted: true, content: null }),
        messageId, { is_deleted: true, content: null },
      ),
    }));
  },

  updatePublishStatus: (messageId, isPublished) => {
    set((state) => ({ messages: patchMessage(state.messages, messageId, { is_published: isPublished }) }));
  },

  updateMessageContent: (messageId, content, isEdited) => {
    // ★ #501 引用している側の写しも新しい本文に
    set((state) => ({
      messages: patchQuotes(patchMessage(state.messages, messageId, { content, is_edited: isEdited }), messageId, { content }),
    }));
  },

  updateTranscription: (messageId, transcription) => {
    set((state) => ({
      messages: patchMessage(state.messages, messageId, (m) => ({
        transcription: { ...m.transcription, ...transcription } as Transcription,
      })),
    }));
  },

  setReplyTo: (message) => {
    set({ replyTo: message });
  },

  clearReplyTo: () => {
    set({ replyTo: null });
  },

  pendingAgentMessage: null,
  setPendingAgentMessage: (message) => {
    set({ pendingAgentMessage: message });
  },
  clearPendingAgentMessage: () => {
    set({ pendingAgentMessage: null });
  },

  clearMessages: () => {
    set({ messages: [], hasMore: true, error: null, replyTo: null });
  },
}));
