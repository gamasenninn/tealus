import { create } from 'zustand';
import { api } from '../services/api';
import { patchMessage, patchQuotes } from './patchMessage';
import { getCachedMessages, cacheMessages, evictRoomView, isGoneFromRoom } from './roomViewCache';
import type { Message, MessageTag, Reaction, LinkPreview, Transcription } from '../types';

// types.ts の Message には link_preview (単数、socket 'link:preview' で注入) が無いため local 拡張。
export type StoreMessage = Message & { link_preview?: LinkPreview | null };

/** #538 追いつくときに読む最大のページ数 (20 件 × 5 = 100 件)。超えたら最新に置き換える */
const CATCH_UP_MAX_PAGES = 5;

interface MessageState {
  messages: StoreMessage[];
  /** #600 いま messages を持っている部屋 (離れたときに覚える先・遅れて届いた別の部屋の応答を捨てる目印) */
  roomId: string | null;
  /** #600 前に開いたときの中身を出している (取り直しがまだ届いていない) */
  isStale: boolean;
  hasMore: boolean;
  /** #511 最新まで読み終えていないか (日付・引用へ飛んだあと)。true の間は届いた新着を後ろにつながない */
  hasNewer: boolean;
  isLoading: boolean;
  error: string | null;
  replyTo: Message | null;
  fetchMessages: (roomId: string, around?: string | null) => Promise<void>;
  loadMore: (roomId: string) => Promise<void>;
  /** #511 一番新しい投稿の後ろを読み足す */
  loadNewer: (roomId: string) => Promise<void>;
  /** #538 つなぎ直し・表に戻ったときに、手元の最後より新しい分を足す (置き換えない) */
  catchUp: (roomId: string) => Promise<void>;
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
  roomId: null,
  isStale: false,
  hasMore: true,
  hasNewer: false,
  isLoading: false,
  error: null,
  replyTo: null,

  fetchMessages: async (roomId, around = null) => {
    // ★ #600 別の部屋を開くときは、前に開いたときの中身を先に出す (取り直しが届くまで「何もない画面」にしない)。
    //   検索から特定の投稿に飛ぶ (around) ときは出さない (今までどおり取りに行く)
    if (get().roomId !== roomId) {
      const cached = around ? undefined : getCachedMessages(roomId);
      set(cached
        ? { roomId, messages: cached, isStale: true, hasMore: true, hasNewer: false }
        : { roomId, isStale: false });
    }
    try {
      set({ isLoading: true, error: null });
      const data = await api.getMessages(roomId, null, 20, around);
      if (get().roomId !== roomId) return;   // ★ #600 取りに行っている間に別の部屋へ移った: 今の部屋に書かない
      set({
        isStale: false,
        messages: around ? data.messages : data.messages.reverse(),
        // ★ #511 around は「その投稿以降」なので、件数は上 (古い方) があるかを表さない。
        //   件数で決めていた頃は、最近の日へ飛ぶと上にもスクロールできなかった (無ければ loadMore が 0 件で止める)
        hasMore: around ? true : data.messages.length >= 20,
        hasNewer: around ? data.messages.length >= 20 : false,
        isLoading: false,
      });
    } catch (err) {
      if (get().roomId !== roomId) return;
      // ★ #600 外された・消された部屋なら、覚えた分を捨てて画面からも消す。圏外などでは前の中身を出したまま理由を添える
      if (isGoneFromRoom(err)) {
        evictRoomView(roomId);
        set({ messages: [], hasMore: false });
      }
      // ★ #592 理由を添える (以前は権限が無いのも圏外も同じ定型文だった)
      set({ isLoading: false, isStale: false, error: `メッセージを読み込めませんでした: ${err instanceof Error ? err.message : String(err)}` });
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
      // ★ 理由を添える (#592 で fetchMessages だけ直し、ここは取り残していた。改善ループ 10-13)
      set({ isLoading: false, error: `過去のメッセージを読み込めませんでした: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  loadNewer: async (roomId) => {
    const { messages, isLoading, hasNewer } = get();
    if (!hasNewer || messages.length === 0 || isLoading) return;
    try {
      set({ isLoading: true });
      const newestId = messages[messages.length - 1].id;
      const data = await api.getMessagesAfter(roomId, newestId);
      set((state) => {
        const have = new Set(state.messages.map((x) => x.id));
        return {
          messages: [...state.messages, ...data.messages.filter((x) => !have.has(x.id))],
          hasNewer: data.messages.length >= 20,
          isLoading: false,
        };
      });
    } catch (err) {
      set({ isLoading: false, error: `新しいメッセージを読み込めませんでした: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  catchUp: async (roomId) => {
    // ★ #538 以前はつなぎ直しでは取り直さず (切れていた間の投稿が抜けた)、表に戻ると最新 20 件に置き換えて
    //   読んでいた位置が消えた。手元の最後より新しい分だけを足す。抜けが多すぎるときだけ最新に置き換える
    const { messages, hasNewer, isLoading } = get();
    if (hasNewer) return;   // 過去の位置を見ている最中。下へスクロールしたときに loadNewer が読み足す
    if (isLoading) return;  // 開いた直後の読み込み中 (検索から開いた位置を上書きしない)
    if (messages.length === 0) { await get().fetchMessages(roomId); return; }
    try {
      let newestId = messages[messages.length - 1].id;
      const fetched: Message[] = [];
      for (let page = 0; page < CATCH_UP_MAX_PAGES; page++) {
        const data = await api.getMessagesAfter(roomId, newestId, 20);
        fetched.push(...data.messages);
        if (data.messages.length < 20) {
          set((state) => {
            const have = new Set(state.messages.map((x) => x.id));
            return { messages: [...state.messages, ...fetched.filter((x) => !have.has(x.id))] };
          });
          return;
        }
        newestId = data.messages[data.messages.length - 1].id;
      }
      await get().fetchMessages(roomId);   // 抜けが多すぎる: 最新に置き換える
    } catch {
      // 取れなくても投げない (次の機会に追いつく)
    }
  },

  addMessage: (message) => {
    set((state) => {
      // ★ #511 最新まで読み終えていない間は後ろにつながない (つなぐと間が抜けたまま並ぶ)。下端まで読み足したときに入る
      if (state.hasNewer) return state;
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
    set((state) => {
      const messages = patchMessage(state.messages, messageId, (m) => ({
        transcription: { ...m.transcription, ...transcription } as Transcription,
      }));
      // ★ #501 の残り: 文字が入った知らせなら、引用の写しも直す (サーバーと同じ「整形 → 無ければ生」)。
      //   状態だけの知らせ (文字起こし中など) では触らない
      if (!('formatted_text' in transcription) && !('raw_text' in transcription)) return { messages };
      const text = transcription.formatted_text || transcription.raw_text || null;
      return { messages: patchQuotes(messages, messageId, { content: text }) };
    });
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
    // ★ #600 離れるときの姿を覚える (開いている間に届いた新着・削除・編集も入っている)。
    //   過去の位置を見ていた (最新まで読んでいない) とき・取り直しが届いていないときは覚え直さない
    const { roomId, messages, hasNewer, isStale } = get();
    if (roomId && !hasNewer && !isStale) cacheMessages(roomId, messages);
    set({ messages: [], roomId: null, isStale: false, hasMore: true, hasNewer: false, error: null, replyTo: null });
  },
}));
