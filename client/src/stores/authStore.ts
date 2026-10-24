import { create } from 'zustand';
import { api } from '../services/api';
import type { AuthResponse } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { registerPushNotification, startPushResumeRefresh, unregisterPushNotification } from '../services/pushNotification';
import { clearRoomViewCache } from './roomViewCache';
import { useRoomStore } from './roomStore';

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
      startPushResumeRefresh();   // ★ 10-16 画面が表に出たときも送り直す (本体は 30 日送り直されない宛先を外す)
      void moveLegacySoundOff(data.user, set);
    } catch {
      localStorage.removeItem('token');
      api.setToken(null);
      set({ user: null, token: null, isLoading: false });
    }
  },

  login: async (login_id, password) => {
    const data = await api.login(login_id, password);
    // ★ #600 監査 B: ログアウトせずに /login から別の人が入っても、前の人が覚えた部屋の中身を出さない
    clearRoomViewCache();
    api.setToken(data.token);
    connectSocket(data.token);
    set({ user: data.user, token: data.token });
    registerPushNotification();
    startPushResumeRefresh();
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
    clearRoomViewCache();   // ★ #600 同じ画面で別の人がログインしても、前の人の会話を先に出さない
    // ★ 部屋の一覧と開いていた部屋も捨てる (改善ループ 15 回目。次の人のログイン直後に前の人の一覧が一瞬出ていた)
    useRoomStore.getState().reset();   // ★ 走っている取り直しの応答も捨てる (改善ループ 16 回目)
    set({ user: null, token: null });
  },

  setNotificationSound: async (on) => {
    const data = await api.updateProfile({ notification_sound: on });
    set({ user: data.user });
  },
}));

// ★ #539 ログインの期限切れ・無効 (本体の 401 / socket の認証エラー) を受けたら、1 回だけログアウトしてログイン画面へ。
//   以前は「ルーム一覧の取得に失敗しました」の帯が出るだけで、アプリを閉じて開き直すまでログイン画面に戻らなかった。
//   ★ ログアウトの中でも本体に問い合わせる (購読の取り消し) ので、その 401 で繰り返さないよう 1 回に絞る。
//     ログアウト後はトークンが無いので、api はもう知らせない
let handlingExpiry = false;
api.setOnUnauthorized?.(() => {   // ?. は api を一部だけ差し替えたテストのため (本番では必ずある)
  if (handlingExpiry) return;
  handlingExpiry = true;
  void useAuthStore.getState().logout().finally(() => {
    handlingExpiry = false;
    window.location.assign('/login');
  });
});
