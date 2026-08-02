/**
 * Agent Server 設定
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { logger } from './lib/logger.mts';

dotenv.config();

// TTS Provider — 'browser' | 'aivis-cloud' | 'none'
// unset 時は AIVIS_API_KEY の有無で自動判定（既存ユーザー保護）。
// 解決結果をモジュール load 時にログ出力 — OSS 採用者のトラブルシュート用。
export const TTS_PROVIDER = process.env.TTS_PROVIDER
  || (process.env.AIVIS_API_KEY ? 'aivis-cloud' : 'browser');

logger.info(
  `TTS provider: ${TTS_PROVIDER} `
  + `(AIVIS_API_KEY: ${process.env.AIVIS_API_KEY ? `set, ${process.env.AIVIS_API_KEY.length} chars` : 'unset'}, `
  + `TTS_PROVIDER env: ${process.env.TTS_PROVIDER || 'unset'})`
);

// Deep agent (Claude Code CLI) availability — Claude MAX 契約者向けの premium 機能。
// 起動時に 1 回だけ検出し、不在なら Router が Light に silent fallback する。
// テスト用に AGENT_DEEP_AVAILABLE_OVERRIDE=true|false で強制 override 可能。
function detectClaudeCli(): boolean {
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

export const DEEP_AVAILABLE = detectClaudeCli();

logger.info(
  `Deep agent: ${DEEP_AVAILABLE
    ? 'enabled (claude CLI found)'
    : 'disabled (claude CLI not found — Light のみで動作)'}`
);

// Codex CLI availability — #276 Deep Codex 用の Claude MAX 代替候補。
// 起動時に 1 回だけ検出し、不在なら Router が「Codex CLI + ChatGPT subscription 必要」
// message を返す。テスト用に AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE=true|false で強制 override 可能。
function detectCodexCli(): boolean {
  if (process.env.AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE === 'true') return true;
  if (process.env.AGENT_DEEP_CODEX_AVAILABLE_OVERRIDE === 'false') return false;
  try {
    const cmd = process.platform === 'win32' ? 'codex.cmd' : 'codex';
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

export const DEEP_CODEX_AVAILABLE = detectCodexCli();

logger.info(
  `Deep Codex agent: ${DEEP_CODEX_AVAILABLE
    ? 'enabled (codex CLI found)'
    : 'disabled (codex CLI not found — DEEP_AGENT_PROVIDER=codex 時は要 install)'}`
);

// Server
export const PORT = parseInt(process.env.AGENT_PORT || '4000');

// Tealus API
// ★ 停止を予告するとき、クライアントに伝える「戻ってくるまでの見込み」(ms、#365)。
// デプロイにどれだけかかるかを知っているのはサーバだけなので、クライアントに
// ハードコードさせない (#361 で解いたのと同じ問題を再導入しないため)。
export const CC_SHUTDOWN_EXPECT_BACK_MS = parseInt(process.env.CC_SHUTDOWN_EXPECT_BACK_MS || '30000', 10);

export const TEALUS_API_URL = process.env.TEALUS_API_URL || 'http://localhost:3000';
export const TEALUS_BOT_ID = process.env.TEALUS_BOT_ID;
export const TEALUS_BOT_PASS = process.env.TEALUS_BOT_PASS;

// OpenAI
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const AGENT_LIGHT_MODEL = process.env.AGENT_LIGHT_MODEL || 'gpt-5.4-mini';
export const AGENT_ROUTER_MODEL = process.env.AGENT_ROUTER_MODEL || 'gpt-5.4-mini';

// Light v2 auth path (#258):
// - undefined / 'api-key' (default): OPENAI_API_KEY を渡す (production 向き)
// - 'subscription': apiKey 渡さず ~/.codex/auth.json (codex login 済) で auth
//   ChatGPT Plus/Pro/Team 持ちで dogfood / dev 用、API cost 0、Fast Mode access 可
export const LIGHTV2_AUTH = process.env.LIGHTV2_AUTH;

// Deep Agent Provider (#276): 'claude' (default) | 'codex'
// - 'claude': claude -p 経由 (= Claude MAX 契約必須、既存挙動維持)
// - 'codex':  codex exec 経由 (= ChatGPT subscription or API key)
export const DEEP_AGENT_PROVIDER = process.env.DEEP_AGENT_PROVIDER || 'claude';

// Deep Codex auth (#276): 'subscription' (default) | 'api-key'
// - 'subscription': OPENAI_API_KEY を渡さず ~/.codex/auth.json で auth (★ 安全 default、API cost 0)
// - 'api-key':      OPENAI_API_KEY を渡す (★ 課金注意、Deep mode は 12-50k tokens × call)
export const DEEP_CODEX_AUTH = process.env.DEEP_CODEX_AUTH || 'subscription';

// Deep Codex model (#276): codex exec の -m 引数
export const AGENT_DEEP_CODEX_MODEL = process.env.AGENT_DEEP_CODEX_MODEL || 'gpt-5.4';

// Tavily
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Workspace
// #292 follow-up (= 藤井さん環境 Deep Codex bug fix、6/8 Day 23):
// codex CLI は CODEX_HOME に絶対 path 要求、claude -p は相対容認。
// path.resolve normalize で全 consumer (Deep / Light v2 / sessionManager) に絶対 path 伝播。
export const WORKSPACE_ROOT = path.resolve(process.env.AGENT_WORKSPACE_ROOT || './agent-workspaces');

// Light tier backend selector (#292、6/8 Day 23 mechanism + 6/9 Day 24 default flip):
//   'v1':                    @openai/agents SDK (= API key mode 友好、サブスクなし user 向け)
//   'v2' (default、6/9〜):   codex-sdk (= ChatGPT subscription 反映、サブスク user voice 反映)
//   /abs/path/to/file.js:    自作 backend (processLight export 義務)
// 不正値 / file 不在は silent fallback で 'v1' (= 起動止めない、log に warn、最終 safety net)
export const AGENT_LIGHT_BACKEND = process.env.AGENT_LIGHT_BACKEND || 'v2';

// Webhook
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// MCP Cache
export const MCP_CACHE_TTL = parseInt(process.env.MCP_CACHE_TTL || String(30 * 60 * 1000));  // 30分
export const MCP_SWEEP_INTERVAL = parseInt(process.env.MCP_SWEEP_INTERVAL || String(5 * 60 * 1000));  // 5分

// Limits
// #314: 画像生成 + ギャラリー保存や、organon prompt 込みの重い Deep タスクは 5 分で切れる
// ことがあったため 8 分へ引き上げ（6/21 アイコン生成インシデント）。env で上書き可。
export const DEEP_TIMEOUT = parseInt(process.env.DEEP_TIMEOUT || '480000');  // 8分
// #270: ルーム処理キューの外側タイムアウト。Light v1/v2 path が SDK 内部でハングして
// Promise が永久 pending になっても、この時間でキューを強制 unblock する最終防衛線。
// DEEP_TIMEOUT(8分) + Deep safety net(10秒) より長く取り、正常な Deep 処理は切らない。
export const QUEUE_TASK_TIMEOUT = parseInt(process.env.QUEUE_TASK_TIMEOUT || '540000');  // 9分
export const DEEP_MAX_BUFFER = parseInt(process.env.DEEP_MAX_BUFFER || '10485760');  // 10MB
// LIGHT_CONTEXT_MESSAGES: #230 で削除 (TealusSession 不要、agent が自分で get_messages を呼ぶ)
// LIGHT_MAX_TURNS: D4 哲学下で multi-step tool chain (get_messages → get_message_media → 応答) が必要、
// default 12 (4 step × 3 retry 余地)。8 では PDF 解析で exceed した実績 (#229/#230 follow-up)。
// settings.json の max_turns で UI override 可、env でも override 可
export const LIGHT_MAX_TURNS = parseInt(process.env.LIGHT_MAX_TURNS || '12');
