/**
 * GET /api/config — client が起動時に取得する公開設定。
 *
 * 認証不要。client が build 時 env を持たない設計のため、
 * runtime に fetch して TtsButton / pushNotification / useSocketSync 等で参照する。
 *
 * - tts_provider: agent-server から /public-config 経由で取得（真の情報源）。
 *   agent-server 停止時は 'browser' に safe fallback。
 * - vapid_public_key: server 自身の env から（push 送信に private key も持つため server が真）。
 */
const express = require('express');
const router = express.Router();

const AGENT_FETCH_TIMEOUT_MS = 2000;

router.get('/', async (req, res) => {
  const agentPort = process.env.AGENT_PORT || 4000;
  let ttsProvider = 'browser';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AGENT_FETCH_TIMEOUT_MS);
    const r = await fetch(`http://localhost:${agentPort}/public-config`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const body = await r.json();
      if (body && typeof body.tts_provider === 'string') {
        ttsProvider = body.tts_provider;
      }
    }
  } catch {
    // agent-server 未起動 / タイムアウト → fallback で続行
  }
  res.json({
    tts_provider: ttsProvider,
    vapid_public_key: process.env.VAPID_PUBLIC_KEY || '',
  });
});

module.exports = router;
