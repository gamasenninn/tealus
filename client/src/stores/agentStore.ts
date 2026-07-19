import { create } from 'zustand';
import { api } from '../services/api';

/**
 * #338 Phase 1 — アプリ内アシスタントの identity を保持する共有ストア。
 * MessageInput（🤖ボタン）と MessageBubble（「エージェントに送る」）の両方が、
 * 正しい宛先メンション (@<display_name>) を組むのに参照する。
 * mount 時に一度だけ fetch すれば足りる（identity は起動中不変）。
 */
interface AgentState {
  assistantUserId: string | null;
  assistantName: string | null;
  fetched: boolean;
  fetchIdentity: () => Promise<void>;
}

export const useAgentStore = create<AgentState>()((set, get) => ({
  assistantUserId: null,
  assistantName: null,
  fetched: false,

  fetchIdentity: async () => {
    if (get().fetched) return;
    set({ fetched: true });
    const id = await api.getAgentIdentity();
    set({ assistantUserId: id.user_id, assistantName: id.display_name });
  },
}));
