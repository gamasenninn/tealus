import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadConfig } from './services/clientConfig';
import { useCapabilityStore } from './stores/capabilityStore';
import './index.css';

// PC PWA: ウィンドウ幅をアプリに合わせる
if (window.matchMedia('(display-mode: standalone)').matches && window.innerWidth > 520) {
  window.resizeTo(480, window.outerHeight);
}

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
