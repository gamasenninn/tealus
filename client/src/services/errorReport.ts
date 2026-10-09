import { useAuthStore } from '../stores/authStore';
import { BUILD_ID } from '../utils/buildVersion';

/**
 * #525 画面で起きたエラーを本体のログへ送る (docs/03「画面のエラーの記録」)。
 *
 * ★ 以前は利用者の端末で起きたエラーがどこにも残らなかった。
 * ★ 投稿の本文は送らない。送るのは種類・メッセージ・場所 (スタック)・画面のパス・ビルド ID だけ。
 * ★ 同じものは 1 回だけ・1 回の読み込みで最大 10 件 (描画のたびに同じ例外が出ても溢れない)。
 * ★ 送るのに失敗しても投げない (記録のせいで画面を止めない)。
 */
export type ClientErrorKind = 'render' | 'error' | 'unhandledrejection';

const MAX_PER_LOAD = 10;
const seen = new Set<string>();
let sent = 0;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

export function reportClientError(kind: ClientErrorKind, err: unknown, componentStack?: string | null): void {
  try {
    const message = messageOf(err).slice(0, 500);
    // 描画の失敗は「どの部品で」(componentStack) が先。縮めたファイルの位置 (err.stack) は後ろに
    const firstLines = (s: string | null | undefined) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
    const stack = [...firstLines(componentStack), ...firstLines(err instanceof Error ? err.stack : '')].join('\n').slice(0, 2000);
    const key = `${kind}|${message}|${stack.split('\n')[1] ?? ''}`;
    if (seen.has(key) || sent >= MAX_PER_LOAD) return;
    seen.add(key);
    sent++;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = useAuthStore.getState().token;
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch('/api/client-errors', {
      method: 'POST',
      headers,
      keepalive: true,   // 落ちた直後に読み込み直されても届くように
      body: JSON.stringify({ kind, message, stack, path: window.location.pathname, build: BUILD_ID }),
    }).catch(() => {});
  } catch {
    // 記録の失敗は無視する
  }
}

/** 捕まえていないエラーと Promise の失敗を拾う。main.tsx で 1 回だけ呼ぶ */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e: ErrorEvent) => reportClientError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => reportClientError('unhandledrejection', e.reason));
}
