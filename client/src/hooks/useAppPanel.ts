import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Room, AppUrl } from '../types';

// ★ AppUrl の写しをここに持たない (#607 で pass を足したとき、片方だけ直す形になっていた)
export type { AppUrl };

type RoomWithAppUrls = Room & { app_urls?: AppUrl[] };

export interface UseAppPanelResult {
  showAppPanel: boolean;
  setShowAppPanel: Dispatch<SetStateAction<boolean>>;
  activeAppIndex: number;
  setActiveAppIndex: Dispatch<SetStateAction<number>>;
  appUrls: AppUrl[];
}

/**
 * アプリパネルの状態管理
 * - auto_open による自動オープン
 * - wake_lock フラグによるWake Lock制御
 */
export function useAppPanel(currentRoom: RoomWithAppUrls | null, roomId: string): UseAppPanelResult {
  const [showAppPanel, setShowAppPanel] = useState(false);
  const [activeAppIndex, setActiveAppIndex] = useState(0);
  // ★ 改善ループ 61: 部屋を移った直後は URL の roomId が先に変わり、currentRoom は前の部屋のまま。
  //   その間に前の部屋のアプリを並べると、新しい部屋の番号で通行証を頼んで 404 になり、
  //   元の URL (ベーシック認証の箱が出る方) で開いてしまう。中身が今の部屋になるまで何も並べない
  const appUrls = (currentRoom?.id === roomId && currentRoom.app_urls) || [];

  // Auto-open app panel
  useEffect(() => {
    if (appUrls.length > 0) {
      const autoIdx = appUrls.findIndex(a => a.auto_open);
      if (autoIdx >= 0) {
        setShowAppPanel(true);
        setActiveAppIndex(autoIdx);
      }
    }
  }, [currentRoom?.id]);

  // App panel wake lock
  useEffect(() => {
    let appWakeLock: WakeLockSentinel | null = null;

    const acquireAppWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && !appWakeLock) {
          appWakeLock = await navigator.wakeLock.request('screen');
          appWakeLock.addEventListener('release', () => { appWakeLock = null; });
        }
      } catch (e) { /* not supported */ }
    };

    if (showAppPanel && appUrls[activeAppIndex]?.wake_lock) {
      acquireAppWakeLock();
    }

    return () => {
      if (appWakeLock) { appWakeLock.release(); appWakeLock = null; }
    };
  }, [showAppPanel, activeAppIndex, appUrls]);

  return { showAppPanel, setShowAppPanel, activeAppIndex, setActiveAppIndex, appUrls };
}
