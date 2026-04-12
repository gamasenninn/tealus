import { useState, useEffect } from 'react';

/**
 * アプリパネルの状態管理
 * - auto_open による自動オープン
 * - wake_lock フラグによるWake Lock制御
 */
export function useAppPanel(currentRoom) {
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
    let appWakeLock = null;

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
