/**
 * Runtime config loader.
 *
 * client は build 時 env (`import.meta.env.VITE_*`) を持たず、
 * 起動時に GET /api/config を 1 回だけ叩いて結果をモジュール内 cache に保持する。
 * 以降は同期的に getConfig() で参照可能。
 *
 * fetch 失敗時は FALLBACK で起動継続し、次の loadConfig (ログインの確かめが通ったとき) で取り直す。
 */
import type { ClientConfig } from '../types';

export interface RuntimeConfig extends ClientConfig {
  tts_provider?: string;
  vapid_public_key?: string;
}

const FALLBACK: RuntimeConfig = Object.freeze({ tts_provider: 'browser', vapid_public_key: '' });

let cached: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig> | null = null;

export function loadConfig(): Promise<RuntimeConfig> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  // ★ 取れなかったときの FALLBACK は覚えない (次の loadConfig で取り直す)。覚えると、圏外で開いた端末は
  //   電波が戻っても起動し直すまで通知の鍵が空のままで、帯も登録も出なかった (2026-10-30)
  inflight = fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((c: RuntimeConfig | null) => {
      if (c) cached = c;
      inflight = null;
      return c || FALLBACK;
    });
  return inflight;
}

export function getConfig(): RuntimeConfig {
  return cached || FALLBACK;
}
