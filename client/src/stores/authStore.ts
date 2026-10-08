import { create } from 'zustand';
import { api } from '../services/api';
import type { AuthResponse } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { registerPushNotification, unregisterPushNotification } from '../services/pushNotification';

/** #508 購読の取り消しを待つ上限。返ってこなくてもログアウトは終わらせる */
const UNSUBSCRIBE_WAIT_MS = 3000;
import type { User } from '../types';
import { LEGACY_SOUND_KEY, shouldMoveLegacySoundOff } from '../utils/messageSound';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  login: (login_id: string, password: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  /** 通知音 (アカウントごと、2026-10-08)。切るとメッセージのプッシュも音なしになる */
  setNotificationSound: (on: boolean) => Promise<void>;
}

/**
 * 端末に残った「通知音を切る」(localStorage) をアカウントへ移す (2026-10-08)。
 * ★ 移さないと、端末で切っていた人が更新した日から急に鳴り出す。失敗したら端末の値を残して次に開いたときにやり直す
 */
async function moveLegacySoundOff(user: User, set: (s: Partial<AuthState>) => void): Promise<void> {
  const legacy = localStorage.getItem(LEGACY_SOUND_KEY);
  if (legacy === null || user.notification_sound === undefined) return;
  if (!shouldMoveLegacySoundOff(user, legacy)) { localStorage.removeItem(LEGACY_SOUND_KEY); return; }
  try {
    const data = await api.updateProfile({ notification_sound: false });
    set({ user: data.user });
    localStorage.removeItem(LEGACY_SOUND_KEY);
  } catch (err) {
    console.warn('[sound] 端末の設定をアカウントへ移せませんでした:', err);
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: true,

  initialize: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      api.setToken(token);
      const data = await api.getMe();
      connectSocket(token);
      set({ user: data.user, token, isLoading: false });
      registerPushNotification();
      void moveLegacySoundOff(data.user, set);
    } catch {
      localStorage.removeItem('token');
      api.setToken(null);
      set({ user: null, token: null, isLoading: false });
    }
  },

  login: async (login_id, password) => {
    const data = await api.login(login_id, password);
    api.setToken(data.token);
    connectSocket(data.token);
    set({ user: data.user, token: data.token });
    registerPushNotification();
    void moveLegacySoundOff(data.user, set);
    return data;
  },

  logout: async () => {
    // ★ #508 トークンを消す前に通知の購読を外す (後だとサーバーへの取り消しが認証で弾かれる)
    await Promise.race([
      unregisterPushNotification(),
      new Promise<void>((resolve) => setTimeout(resolve, UNSUBSCRIBE_WAIT_MS)),
    ]);
    api.setToken(null);
    disconnectSocket();
    set({ user: null, token: null });
  },

  setNotificationSound: async (on) => {
    const data = await api.updateProfile({ notification_sound: on });
    set({ user: data.user });
  },
}));
