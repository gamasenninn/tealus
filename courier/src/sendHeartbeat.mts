/**
 * 鼓動を本体へ送る (docs/12 §7・§12.6、docs/09 §3.2)。口座は配達役専用の機械の口座 (2026-11-19 利用者)。
 * 段階 3 (docs/12 §14) の相手の PC では、その班の bot の口座 (鼓動は口座ごとに 1 行なので中央のものを上書きしない)。
 * ★ ログインの鍵の扱いは authClient (便の取り寄せと同じもの)
 * ★ 失敗しても投げない (鼓動が送れなくても配達は止めない)。送れたかを返す
 */
import { authClient, type CourierAuth, type FetchLike } from './authClient.mts';

export type { CourierAuth } from './authClient.mts';

export function heartbeatSender(auth: CourierAuth, fetchImpl?: FetchLike) {
  const call = authClient(auth, fetchImpl);
  return async function send(info: Record<string, unknown>): Promise<boolean> {
    const r = await call('POST', '/api/bot/heartbeat', { name: 'courier', info });
    return r.status >= 200 && r.status < 300;
  };
}
