/**
 * Capability Store — server から取得した runtime capability を保持。
 *
 * 初期値は main.jsx で /api/config (clientConfig.js) から hydrate。
 * Socket.IO 'capability:changed' event で動的に更新される (services/socket.js)。
 *
 * 現状の関心: realtime_voice_available (rtc-server 到達可能性)
 *   - true: 通話 / トランシーバー UI を表示
 *   - false: 関連 UI を非表示 (UX トラップ防止)
 */
import { create } from 'zustand';

export const useCapabilityStore = create((set) => ({
  realtimeVoiceAvailable: false,

  setRealtimeVoice: (v) => set({ realtimeVoiceAvailable: !!v }),

  // /api/config からの初期 hydrate 用
  hydrateFromConfig: (config) => {
    if (config && typeof config.realtime_voice_available === 'boolean') {
      set({ realtimeVoiceAvailable: config.realtime_voice_available });
    }
  },
}));
