import { create } from 'zustand';
import { api } from '../services/api';
import type { AuthResponse } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { loadConfig } from '../services/clientConfig';
import { useCapabilityStore } from './capabilityStore';
import { pushPermission, registerPushNotification, startPushResumeRefresh, unregisterPushNotification } from '../services/pushNotification';

/**
 * 許可済みの端末だけ、黙って宛先を登録し直す (2026-10-29 小野さん判断 6)。
 * ★ 以前はログインと起動のたびに無条件に登録し、まだ聞いていない端末では説明なしで許可の問いが出た。
 *   まだ聞いていない端末は PushOnboardingBanner が説明してから聞く
 */
/**
 * 起動時に設定を取れなかった (圏外で開いた) 端末は、ログインが通ったところで取り直す (2026-10-30)。
 * ★ 通知の鍵が空のままだと帯も登録も出ない。通話・トランシーバーの表示 (capability) にも入れ直す
 */
async function refreshConfig(): Promise<void> {
  useCapabilityStore.getState().hydrateFromConfig(await loadConfig());
}

function registerPushIfAllowed(): void {
  if (pushPermission() === 'granted') void registerPushNotification();
}
import { clearRoomViewCache } from './roomViewCache';
import { useRoomStore } from './roomStore';

/** #508 購読の取り消しを待つ上限。返ってこなくてもログアウトは終わらせる */
const UNSUBSCRIBE_WAIT_MS = 3000;

/** 走っている initialize (重ねて呼ばれたら同じものを返す) */
let initializing: Promise<void> | null = null;

/**
 * 同じ画面で次の人に、前の人が覚えたものを出さない。ログアウトと、ログアウトせずに /login から入る道の両方から呼ぶ
 * (改善ループ 19 回目に 1 つにまとめた。logout にだけ足していて、login の道に残っていた)
 */
function forgetPreviousUser(): void {
  clearRoomViewCache();   // ★ #600 部屋の中身
  // ★ 部屋の一覧と開いていた部屋 (改善ループ 15 回目)。走っている取り直しの応答も捨てる (16 回目)
  useRoomStore.getState().reset();
  // ★ 検索の結果 (本文入り) とスクロール位置 (18 回目)
  try { sessionStorage.removeItem('searchCache'); sessionStorage.removeItem('searchScroll'); } catch { /* 保存領域が使えないだけ */ }
}
import type { User } from '../types';
import { LEGACY_SOUND_KEY, shouldMoveLegacySoundOff } from '../utils/messageSound';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** ★ 本体につながらないまま開いた (鍵は残している)。画面は「つながっていません」を出し、つなぎ直す (2026-10-27) */
  offline: boolean;
  initialize: () => Promise<void>;
  login: (login_id: string, password: string) => Promise<AuthResponse>;
  /** expired: 鍵が切れたあと (本体への宛先の取り外しを頼まない) */
  logout: (opts?: { expired?: boolean }) => Promise<void>;
  /** プロフィールの保存の応答の user をそのまま入れる (initialize で取り直さない、2026-10-29) */
  setUser: (user: User) => void;
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

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: true,
  offline: false,

  initialize: () => {
    // ★ 走っている最中なら同じ試行を返す (2026-10-29 改善ループ 20 回目)。「つながっていません」の 10 秒ごとの再試行と
    //   電波が戻ったときの再試行が、前の試行 (最長 31 秒) を待たずに重なり、戻った瞬間に socket と通知の登録が複数走った
    if (initializing) return initializing;
    let tokenChanged = false;
    initializing = (async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        set({ isLoading: false });
        return;
      }
      try {
        api.setToken(token);
        const data = await api.getMe();
        // ★ 待っている間に鍵が替わった (ログアウト → 別の人がログイン) なら何もしない (2026-10-29 改善ループ 21 回目)。
        //   遅れて終わった古い試行が、次の人の状態を前の人で上書きし、socket を前の人の鍵で張り直していた。
        //   ★ 新しい鍵で取り直す (改善ループ 22 回目)。何もせず返すと、起動中に別のタブで鍵が替わったとき「読み込み中...」のまま止まった
        if (localStorage.getItem('token') !== token) { tokenChanged = true; return; }
        connectSocket(token);
        await refreshConfig();
        set({ user: data.user, token, isLoading: false, offline: false });
        registerPushIfAllowed();
        startPushResumeRefresh();   // ★ 10-16 画面が表に出たときも送り直す (本体は 30 日送り直されない宛先を外す)
        void moveLegacySoundOff(data.user, set);
      } catch (err) {
        // ★ 401 は api が知らせ、ログアウト (下の setOnUnauthorized) が鍵を消す。ここで先に消すと、ログアウトの宛先の取り外しが
        //   鍵なしで飛んで 401 になり、本体に死んだ宛先が残っていた (改善ループ 18 回目、14 日で 10 回)
        const status = (err as { status?: number } | null)?.status;
        if (status === 401) {
          set({ user: null, token: null, isLoading: false });
          return;
        }
        // ★ つながらない (圏外・時間切れ・本体の 5xx) なら鍵を残す (2026-10-27 小野さん判断)。以前は鍵を消してログイン画面に落とし、
        //   電波が戻ってもパスワードの入れ直しになっていた。ログイン中の読み直し (プロフィールの保存の後など) なら今の画面のまま
        if (status === undefined || status >= 500 || status === 408 || status === 429) {
          if (get().user) { set({ isLoading: false }); return; }
          set({ isLoading: false, offline: true });
          return;
        }
        api.setToken(null);   // ★ 自分の鍵のときだけ消す (別のタブで入り直した鍵は残す。2026-10-30 判断 D)
        set({ user: null, token: null, isLoading: false });
      }
    })().finally(() => { initializing = null; }).then(() => (tokenChanged ? get().initialize() : undefined));
    return initializing;
  },

  login: async (login_id, password) => {
    const data = await api.login(login_id, password);
    // ★ #600 監査 B: ログアウトせずに /login から別の人が入っても、前の人が覚えたものを出さない
    forgetPreviousUser();
    api.setToken(data.token);
    connectSocket(data.token);
    await refreshConfig();
    set({ user: data.user, token: data.token, offline: false });
    registerPushIfAllowed();
    startPushResumeRefresh();
    void moveLegacySoundOff(data.user, set);
    return data;
  },

  logout: async (opts) => {
    // ★ #508 トークンを消す前に通知の購読を外す (後だとサーバーへの取り消しが認証で弾かれる)。
    //   ★ 鍵が切れたあとは本体に頼まない (2026-10-29。切れた鍵では 401 になるだけ)
    await Promise.race([
      unregisterPushNotification({ server: !opts?.expired }),
      new Promise<void>((resolve) => setTimeout(resolve, UNSUBSCRIBE_WAIT_MS)),
    ]);
    api.setToken(null);
    disconnectSocket();
    forgetPreviousUser();
    set({ user: null, token: null, offline: false });
  },

  setUser: (user) => set({ user }),

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
  void useAuthStore.getState().logout({ expired: true }).finally(() => {
    handlingExpiry = false;
    window.location.assign('/login');
  });
});
