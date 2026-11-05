import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadConfig } from './services/clientConfig';
import { useCapabilityStore } from './stores/capabilityStore';
import { initLaunchFiles } from './services/launchFiles';
import { installGlobalErrorHandlers, reportClientError } from './services/errorReport';
import { recordBoot, forgetBoots, BOOT_LOOP_LIMIT } from './services/bootGuard';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';

// #525 画面で起きたエラーを本体のログへ (読み込みの最初に。設定の取得で落ちても拾えるように)
installGlobalErrorHandlers();

// ★★★★ #445 (2026-09-18): 共有ファイルの 2 本目の受け口を **いちばん早く**開く。
//   ★ launchQueue の consumer は launch のときに 1 回だけ呼ばれるので、
//     loadConfig の後や /share の mount 後に登録すると **取り逃がす**。
//   ★★ 受け取ったものは launchFiles が持ち、画面が後から取りに来る。
initLaunchFiles();

// #237 Phase 1: PC PWA の強制 480px 縮小は削除
// (DesktopShell の 2-pane layout で横領域を活用するため)
// 旧 resizeTo(480, ...) は mobile-first 設計の名残、新 design では矛盾する

function storageOrNull(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

// ★ 改善ループ 41: 読み込みの繰り返しに気づいたら、本体を叩かずに止まる。2026-11-04 に Mac の 1 台が開いては
//   数十ミリ秒で消されるのを 3 時間繰り返し、本体へ約 11 万回の要求を送った (原因は端末の側、推測)。
//   本体へは超えた最初の 1 回だけ知らせる (止まっている間も毎回知らせると、それが新しい連打になる)
const storage = storageOrNull();
const boot = storage ? recordBoot(storage) : { looping: false, count: 0 };
const root = ReactDOM.createRoot(document.getElementById('root')!);

if (boot.looping) {
  if (boot.count === BOOT_LOOP_LIMIT + 1) {
    reportClientError('error', new Error(`起動の繰り返しを止めました (30 秒に ${boot.count} 回)`));
  }
  root.render(
    <div style={{ padding: 24, lineHeight: 1.7, fontSize: 16 }}>
      <p>読み込みが短い間に何度も繰り返されたので、いったん止めました。</p>
      <p>アプリを閉じて開き直してください。直らないときは、ブラウザで開いてください。</p>
      <button style={{ fontSize: 16, padding: '8px 16px' }} onClick={() => { if (storage) forgetBoots(storage); location.reload(); }}>
        このまま開く
      </button>
    </div>
  );
} else {
// runtime config を取得してから render（fetch 失敗時は fallback で起動継続）
loadConfig().then((config) => {
  // capability の初期値を hydrate (Socket.IO 接続後は 'capability:changed' で動的更新)
  useCapabilityStore.getState().hydrateFromConfig(config);
}).finally(() => {
  root.render(
    <React.StrictMode>
      {/* #525 一番外の受け止め。落ちても真っ白にせず「読み込み直す」を出す */}
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>
  );
});
}
