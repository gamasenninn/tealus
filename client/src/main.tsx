import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadConfig } from './services/clientConfig';
import { useCapabilityStore } from './stores/capabilityStore';
import { initLaunchFiles } from './services/launchFiles';
import './index.css';

// ★★★★ #445 (2026-09-18): 共有ファイルの 2 本目の受け口を **いちばん早く**開く。
//   ★ launchQueue の consumer は launch のときに 1 回だけ呼ばれるので、
//     loadConfig の後や /share の mount 後に登録すると **取り逃がす**。
//   ★★ 受け取ったものは launchFiles が持ち、画面が後から取りに来る。
initLaunchFiles();

// #237 Phase 1: PC PWA の強制 480px 縮小は削除
// (DesktopShell の 2-pane layout で横領域を活用するため)
// 旧 resizeTo(480, ...) は mobile-first 設計の名残、新 design では矛盾する

// runtime config を取得してから render（fetch 失敗時は fallback で起動継続）
loadConfig().then((config) => {
  // capability の初期値を hydrate (Socket.IO 接続後は 'capability:changed' で動的更新)
  useCapabilityStore.getState().hydrateFromConfig(config);
}).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
