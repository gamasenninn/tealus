/**
 * Agent Server 設定
 */
require('dotenv').config();
const { spawnSync } = require('child_process');
const logger = require('./lib/logger');

// TTS Provider — 'browser' | 'aivis-cloud' | 'none'
// unset 時は AIVIS_API_KEY の有無で自動判定（既存ユーザー保護）。
// 解決結果をモジュール load 時にログ出力 — OSS 採用者のトラブルシュート用。
const TTS_PROVIDER = process.env.TTS_PROVIDER
  || (process.env.AIVIS_API_KEY ? 'aivis-cloud' : 'browser');

logger.info(
  `TTS provider: ${TTS_PROVIDER} `
  + `(AIVIS_API_KEY: ${process.env.AIVIS_API_KEY ? `set, ${process.env.AIVIS_API_KEY.length} chars` : 'unset'}, `
  + `TTS_PROVIDER env: ${process.env.TTS_PROVIDER || 'unset'})`
);

// Deep agent (Claude Code CLI) availability — Claude MAX 契約者向けの premium 機能。
// 起動時に 1 回だけ検出し、不在なら Router が Light に silent fallback する。
// テスト用に AGENT_DEEP_AVAILABLE_OVERRIDE=true|false で強制 override 可能。
function detectClaudeCli() {
  if (process.env.AGENT_DEEP_AVAILABLE_OVERRIDE === 'true') return true;
  if (process.env.AGENT_DEEP_AVAILABLE_OVERRIDE === 'false') return false;
  try {
    const cmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const result = spawnSync(cmd, ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

const DEEP_AVAILABLE = detectClaudeCli();

logger.info(
  `Deep agent: ${DEEP_AVAILABLE
    ? 'enabled (claude CLI found)'
    : 'disabled (claude CLI not found — Light のみで動作)'}`
);

module.exports = {
  // Server
  PORT: parseInt(process.env.AGENT_PORT || '4000'),

  // Tealus API
  TEALUS_API_URL: process.env.TEALUS_API_URL || 'http://localhost:3000',
  TEALUS_BOT_ID: process.env.TEALUS_BOT_ID,
  TEALUS_BOT_PASS: process.env.TEALUS_BOT_PASS,

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AGENT_LIGHT_MODEL: process.env.AGENT_LIGHT_MODEL || 'gpt-5.4-mini',
  AGENT_ROUTER_MODEL: process.env.AGENT_ROUTER_MODEL || 'gpt-5.4-mini',

  // Tavily
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,

  // Workspace
  WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT || './agent-workspaces',

  // Webhook
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',

  // MCP Cache
  MCP_CACHE_TTL: parseInt(process.env.MCP_CACHE_TTL || String(30 * 60 * 1000)),  // 30分
  MCP_SWEEP_INTERVAL: parseInt(process.env.MCP_SWEEP_INTERVAL || String(5 * 60 * 1000)),  // 5分

  // Limits
  DEEP_TIMEOUT: parseInt(process.env.DEEP_TIMEOUT || '300000'),  // 5分
  DEEP_MAX_BUFFER: parseInt(process.env.DEEP_MAX_BUFFER || '10485760'),  // 10MB
  // LIGHT_CONTEXT_MESSAGES: #230 で削除 (TealusSession 不要、agent が自分で get_messages を呼ぶ)

  // TTS Provider
  TTS_PROVIDER,

  // Deep agent CLI availability
  DEEP_AVAILABLE,
};
