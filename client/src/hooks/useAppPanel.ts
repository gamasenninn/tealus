import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Room } from '../types';

// Room (types.ts) に app_urls が無いため local 補完 (server の room 応答が持つ)
export interface AppUrl {
  url: string;
  title?: string;
  auto_open?: boolean;
  wake_lock?: boolean;
  ratio?: number;
}

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
export function useAppPanel(currentRoom: RoomWithAppUrls | null): UseAppPanelResult {
  const [showAppPanel, setShowAppPanel] = useState(false);
  const [activeAppIndex, setActiveAppIndex] = useState(0);
  const appUrls = currentRoom?.app_urls || [];

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
