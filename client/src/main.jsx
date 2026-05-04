import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadConfig } from './services/clientConfig';
import { useCapabilityStore } from './stores/capabilityStore';
import './index.css';

// #237 Phase 1: PC PWA の強制 480px 縮小は削除
// (DesktopShell の 2-pane layout で横領域を活用するため)
// 旧 resizeTo(480, ...) は mobile-first 設計の名残、新 design では矛盾する

// runtime config を取得してから render（fetch 失敗時は fallback で起動継続）
loadConfig().then((config) => {
  // capability の初期値を hydrate (Socket.IO 接続後は 'capability:changed' で動的更新)
  useCapabilityStore.getState().hydrateFromConfig(config);
}).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
