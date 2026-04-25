import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadConfig } from './services/clientConfig';
import './index.css';

// PC PWA: ウィンドウ幅をアプリに合わせる
if (window.matchMedia('(display-mode: standalone)').matches && window.innerWidth > 520) {
  window.resizeTo(480, window.outerHeight);
}

// runtime config を取得してから render（fetch 失敗時は fallback で起動継続）
loadConfig().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
