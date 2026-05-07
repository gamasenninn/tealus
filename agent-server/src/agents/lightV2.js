/**
 * Light v2 Agent — codex-sdk backed (#258)
 *
 * 現 Light v1 (`@openai/agents` SDK in-process) の並列 alternative。
 * `/light2` prefix で起動、`@openai/codex-sdk` 経由で codex CLI を spawn (SDK が hide)、
 * MCP ecosystem (tealus / filesystem / tavily 等) を共有して agent 動作。
 *
 * 設計判断:
 * - thread lifecycle: per-message 都度新規 (Light v1 の D4 哲学と同じ、session 持たない)
 * - MCP config: 動的 (Codex({ config: { mcp_servers } }) で per-request 注入)
 * - approval policy: 'never' (Tealus chat に approval UI なし、Light v1 と同方針)
 * - sandbox: 'workspace-write' (workspace 内 file 操作は許可、外部は不可)
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { loadMemoryForPrompt } = require('../memory/fileMemory');

// codex-sdk は ESM のみ。CommonJS から動的 import で読む
let CodexCtor = null;
async function getCodex() {
  if (!CodexCtor) {
    const mod = await import('@openai/codex-sdk');
    CodexCtor = mod.Codex;
  }
  return CodexCtor;
}

// AGENT_CONFIG_DIR env で override 可能 (test isolation 用、production では unset で default)
const CONFIG_DIR = process.env.AGENT_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');

const MIN_CUSTOM_PROMPT_LENGTH = 50;

function loadSystemPrompt() {
  const customPath = path.join(CONFIG_DIR, 'system_prompt.md');
  const defaultPath = path.join(CONFIG_DIR, 'default_system_prompt.md');
  try {
    if (fs.existsSync(customPath)) {
      const content = fs.readFileSync(customPath, 'utf8').trim();
      if (content && content.length >= MIN_CUSTOM_PROMPT_LENGTH) return content;
    }
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf8').trim();
    }
  } catch {}
  return 'あなたはTealusのAIアシスタントです。';
}

/**
 * 既存 Light v1 の MCP server 配列 (MCPServerStdio instances) を codex SDK config 形式に変換。
 * codex SDK は `--config mcp_servers.<name>.command="..."` 形式で MCP を渡す (SDK 内部で TOML 化)。
 */
function buildCodexMcpConfig(mcpServers) {
  const mcp_servers = {};
  for (const srv of mcpServers || []) {
    if (!srv?.name) continue;
    const params = srv.params || srv._params || {};
    if (!params.command) continue;
    mcp_servers[srv.name] = {
      command: params.command,
      args: params.args || [],
      env: params.env || {},
    };
  }
  return mcp_servers;
}

/**
 * codex event の tool name → Tealus status mapping (Light v1 TOOL_STATUS_MAP の v2 版)
 */
function mapToolToStatus(item) {
  if (item.type === 'mcp_tool_call') {
    const tool = item.tool;
    const TOOL_MAP = {
      tavily_search: { status: 'searching', message: '検索中...' },
      get_messages: { status: 'reading', message: 'メッセージ確認中...' },
      search_messages: { status: 'searching', message: 'メッセージ検索中...' },
      get_message_media: { status: 'reading', message: 'メディア取得中...' },
      read_document: { status: 'reading', message: '文書を読み込み中...' },
      send_message: { status: 'sending', message: 'メッセージ送信中...' },
      send_image: { status: 'sending', message: '画像送信中...' },
      list_tags: { status: 'reading', message: 'タグ確認中...' },
      mark_tag_done: { status: 'writing', message: 'タグ更新中...' },
      read_file: { status: 'reading', message: 'ファイル読み込み中...' },
      read_text_file: { status: 'reading', message: 'ファイル読み込み中...' },
      write_file: { status: 'writing', message: 'ファイル書き込み中...' },
      list_directory: { status: 'reading', message: 'ディレクトリ読み込み中...' },
    };
    return TOOL_MAP[tool] || { status: 'processing', message: `${tool} を実行中...` };
  }
  if (item.type === 'command_execution') {
    return { status: 'processing', message: 'コマンド実行中...' };
  }
  if (item.type === 'web_search') {
    return { status: 'searching', message: '検索中...' };
  }
  if (item.type === 'file_change') {
    return { status: 'writing', message: 'ファイル変更中...' };
  }
  return null;
}

/**
 * Light v2 でメッセージを処理
 */
async function processLightV2({ roomId, prompt, workspacePath, mcpServers }) {
  let lastAgentMessage = null;
  try {
    const Codex = await getCodex();

    // codex SDK 初期化
    // 認証 path 2 通り (codex CLI 標準動作):
    //   1. OPENAI_API_KEY 設定済 → API key 認証 (usage-based billing、production 向き)
    //   2. 未設定 + `codex login` 済 → ~/.codex/auth.json から ChatGPT subscription 認証
    //      (Plus/Pro/Team 等持ってる採用者は追加 API cost 0 で運用可、Fast Mode も使える)
    const mcp_servers = buildCodexMcpConfig(mcpServers);
    const codexOpts = { config: { mcp_servers } };
    if (config.OPENAI_API_KEY) {
      codexOpts.apiKey = config.OPENAI_API_KEY;
    }
    const codex = new Codex(codexOpts);
    logger.debug(`[LightV2] auth path: ${codexOpts.apiKey ? 'API key' : 'subscription (auth.json)'}`);

    // memory + system prompt 構築
    let systemPrompt = loadSystemPrompt();
    const memory = loadMemoryForPrompt(workspacePath);
    if (memory) systemPrompt += `\n\n## 記憶\n${memory}`;
    if (workspacePath) {
      const normalizedPath = workspacePath.replace(/\\/g, '/');
      systemPrompt += `\n\n## ワークスペース\nファイル操作ツールを使う際は、以下のパスを使ってください:\n${normalizedPath}`;
    }

    // thread 開始 (per-message 都度新規)
    const thread = codex.startThread({
      model: config.AGENT_LIGHT_MODEL,
      workingDirectory: workspacePath,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    });

    await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});

    // codex は system prompt を thread option で取らないので、user prompt 先頭に注入
    const fullPrompt = `${systemPrompt}\n\n---\n\nユーザーの質問: ${prompt}`;

    const { events } = await thread.runStreamed(fullPrompt);

    for await (const event of events) {
      try {
        if (event.type === 'item.started') {
          const mapped = mapToolToStatus(event.item);
          if (mapped) {
            await botApi.pushStatus(roomId, mapped.status, mapped.message).catch(() => {});
            logger.info(`[LightV2] tool start: ${event.item.type} (${event.item.tool || event.item.command || ''})`);
          }
        } else if (event.type === 'item.completed') {
          if (event.item.type === 'agent_message') {
            lastAgentMessage = event.item.text;
            await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
          } else {
            const mapped = mapToolToStatus(event.item);
            if (mapped) {
              await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
              logger.info(`[LightV2] tool end: ${event.item.type}`);
            }
          }
        } else if (event.type === 'turn.completed') {
          logger.info(`[LightV2] turn completed, usage: input=${event.usage?.input_tokens} output=${event.usage?.output_tokens}`);
        } else if (event.type === 'turn.failed') {
          logger.error(`[LightV2] turn failed: ${event.error?.message || 'unknown'}`);
        } else if (event.type === 'error') {
          logger.error(`[LightV2] stream error: ${event.message}`);
        }
      } catch (eventErr) {
        logger.warn(`[LightV2] event handler error: ${eventErr.message}`);
      }
    }

    // 最終 response 送信
    if (lastAgentMessage) {
      const content = lastAgentMessage;
      if (content.length > 4000) {
        const chunks = splitMessage(content, 4000);
        for (const chunk of chunks) await botApi.pushMessage(roomId, chunk);
      } else {
        await botApi.pushMessage(roomId, content);
      }
      logger.info(`Light v2 response sent to room ${roomId} (${content.length} chars)`);
    } else {
      logger.warn(`[LightV2] no final agent message captured for room ${roomId}`);
      await botApi.pushMessage(roomId, '応答が取得できませんでした。再度お試しください。');
    }
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
  } catch (err) {
    logger.error(`Light v2 Agent error: ${err.message}`);
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
    try {
      await botApi.pushMessage(roomId, `Light v2 でエラーが発生しました: ${err.message}`);
    } catch (pushErr) {
      logger.error(`Failed to send error message: ${pushErr.message}`);
    }
  }
}

function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  return chunks;
}

module.exports = { processLightV2, splitMessage, buildCodexMcpConfig };
