/**
 * GET /api/config — client が起動時に取得する公開設定。
 *
 * 認証不要。client が build 時 env を持たない設計のため、
 * runtime に fetch して TtsButton / pushNotification / useSocketSync 等で参照する。
 *
 * - tts_provider: agent-server から /public-config 経由で取得（真の情報源）。
 *   agent-server 停止時は 'browser' に safe fallback。
 * - vapid_public_key: server 自身の env から（push 送信に private key も持つため server が真）。
 * - realtime_voice_available: rtc-server reachability の現在値。capabilityWatcher が動的更新。
 *   状態変化は Socket.IO 'capability:changed' でも通知。
 */
import express from 'express';
export const router = express.Router();
import * as capabilityWatcher from '../services/capabilityWatcher.mts';
import { agentUrl } from '../lib/upstream.mts';

const AGENT_FETCH_TIMEOUT_MS = 2000;

/**
 * ★ agent-server の答えは 30 秒使い回す (改善ループ 39)。2026-11-04 に 1 台の端末が 3 時間で 8.7 万回この口を叩き、
 *   そのたびに agent-server へ取りに行っていた。取れなかったとき (fallback) は覚えない (起動直後の 1 回で 30 秒 browser に固まらない)
 */
const PUBLIC_CONFIG_TTL_MS = 30_000;
let cachedTtsProvider: { value: string; at: number } | null = null;
export function resetPublicConfigCache(): void { cachedTtsProvider = null; }

async function fetchTtsProvider(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AGENT_FETCH_TIMEOUT_MS);
    const r = await fetch(`${agentUrl()}/public-config`, { signal: ctrl.signal });   // ★ #556
    clearTimeout(timer);
    if (r.ok) {
      const body = await r.json() as { tts_provider?: unknown };
      if (body && typeof body.tts_provider === 'string') return body.tts_provider;
    }
  } catch {
    // agent-server 未起動 / タイムアウト → fallback で続行
  }
  return null;
}

router.get('/', async (req, res) => {
  let ttsProvider = 'browser';
  if (cachedTtsProvider && Date.now() - cachedTtsProvider.at < PUBLIC_CONFIG_TTL_MS) {
    ttsProvider = cachedTtsProvider.value;
  } else {
    const fetched = await fetchTtsProvider();
    if (fetched !== null) {
      ttsProvider = fetched;
      cachedTtsProvider = { value: fetched, at: Date.now() };
    }
  }
  res.json({
    tts_provider: ttsProvider,
    vapid_public_key: process.env.VAPID_PUBLIC_KEY || '',
    realtime_voice_available: capabilityWatcher.getState(),
  });
});
