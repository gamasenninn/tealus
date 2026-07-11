/**
 * Capability Store — server から取得した runtime capability を保持。
 *
 * 初期値は main.tsx で /api/config (clientConfig.ts) から hydrate。
 * Socket.IO 'capability:changed' event で動的に更新される (services/socket.ts)。
 *
 * 現状の関心: realtime_voice_available (rtc-server 到達可能性)
 *   - true: 通話 / トランシーバー UI を表示
 *   - false: 関連 UI を非表示 (UX トラップ防止)
 */
import { create } from 'zustand';
import type { ClientConfig } from '../types';

interface CapabilityState {
  realtimeVoiceAvailable: boolean;
  setRealtimeVoice: (v: boolean) => void;
  hydrateFromConfig: (config: ClientConfig | null | undefined) => void;
}

export const useCapabilityStore = create<CapabilityState>()((set) => ({
  realtimeVoiceAvailable: false,

  setRealtimeVoice: (v) => set({ realtimeVoiceAvailable: !!v }),

  // /api/config からの初期 hydrate 用
  hydrateFromConfig: (config) => {
    if (config && typeof config.realtime_voice_available === 'boolean') {
      set({ realtimeVoiceAvailable: config.realtime_voice_available });
    }
  },
}));
