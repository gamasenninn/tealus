/**
 * Runtime config loader.
 *
 * client は build 時 env (`import.meta.env.VITE_*`) を持たず、
 * 起動時に GET /api/config を 1 回だけ叩いて結果をモジュール内 cache に保持する。
 * 以降は同期的に getConfig() で参照可能。
 *
 * fetch 失敗時は FALLBACK で起動継続（aivis-cloud は手動リロードで復旧可能）。
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
  inflight = fetch('/api/config')
    .then((r) => (r.ok ? r.json() : FALLBACK))
    .catch(() => FALLBACK)
    .then((c: RuntimeConfig) => {
      cached = c;
      inflight = null;
      return c;
    });
  return inflight;
}

export function getConfig(): RuntimeConfig {
  return cached || FALLBACK;
}
