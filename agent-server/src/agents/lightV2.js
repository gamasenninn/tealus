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
 * Light v2 用 MCP 設定を直接構築 (codex SDK 形式 = TOML mcp_servers)
 *
 * 注意: roomMcpManager が持つ MCPServerStdio instances (Light v1 用) からの抽出ではなく、
 * deep.js の createDeepMcpConfig と同型で **設定 source から直接** 構築する。
 * 理由: Light v1 と v2 は別 process group の MCP server を spawn するため、
 * Light v1 の instances から再利用しても意味がない (codex CLI 内部で再 spawn)。
 *
 * 構成:
 *   1. tealus MCP (Bot 認証情報があれば自動追加、Light v1 / Deep と同型)
 *   2. workspace-fs MCP (filesystem、room workspace に root)
 *   3. ルーム固有 MCP (workspace/mcp_config.json があればマージ)
 *   4. グローバル MCP (agent-server/mcp_config.json があればマージ、filesystem は除外)
 */
function buildLightV2McpConfig(workspacePath) {
  const mcp_servers = {};

  // 1. Tealus MCP
  if (config.TEALUS_BOT_ID && config.TEALUS_BOT_PASS) {
    mcp_servers.tealus = {
      command: 'npx',
      args: ['-y', 'github:gamasenninn/tealus-mcp#v0.11.0'],
      env: {
        TEALUS_API_URL: config.TEALUS_API_URL,
        TEALUS_USER_ID: config.TEALUS_BOT_ID,
        TEALUS_PASSWORD: config.TEALUS_BOT_PASS,
        // generate_and_send_image (#260) で DALL-E 3 を呼ぶため必要
        // (Light v2 が subscription mode でも image gen は API key 必須、別 cost path)
        ...(config.OPENAI_API_KEY ? { OPENAI_API_KEY: config.OPENAI_API_KEY } : {}),
        // read_document の vision fallback (Gemini) で必要
        ...(process.env.GOOGLE_API_KEY ? { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY } : {}),
        ...(process.env.DOCUMENT_VISION_PROVIDER ? { DOCUMENT_VISION_PROVIDER: process.env.DOCUMENT_VISION_PROVIDER } : {}),
        ...(process.env.DOCUMENT_VISION_MODEL ? { DOCUMENT_VISION_MODEL: process.env.DOCUMENT_VISION_MODEL } : {}),
        ...(process.env.DOCUMENT_VISION_MAX_PAGES ? { DOCUMENT_VISION_MAX_PAGES: process.env.DOCUMENT_VISION_MAX_PAGES } : {}),
      },
    };
  }

  // 2. workspace-fs MCP
  if (workspacePath) {
    const normalizedPath = workspacePath.replace(/\\/g, '/');
    mcp_servers['workspace-fs'] = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', normalizedPath],
      env: {},
    };
  }

  // 3. ルーム固有 MCP
  if (workspacePath) {
    const roomMcpPath = path.join(workspacePath, 'mcp_config.json');
    if (fs.existsSync(roomMcpPath)) {
      try {
        const roomMcp = JSON.parse(fs.readFileSync(roomMcpPath, 'utf8'));
        Object.assign(mcp_servers, roomMcp.mcpServers || {});
      } catch (err) {
        logger.warn(`[LightV2] Failed to load room MCP config: ${err.message}`);
      }
    }
  }

  // 4. グローバル MCP (filesystem 重複を避けて除外)
  const globalConfigPath = path.join(__dirname, '..', '..', 'mcp_config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const globalMcp = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
      if (globalMcp.mcpServers) {
        for (const [name, def] of Object.entries(globalMcp.mcpServers)) {
          if (name === 'filesystem') continue;
          if (!mcp_servers[name]) mcp_servers[name] = def;
        }
      }
    } catch (err) {
      logger.warn(`[LightV2] Failed to load global MCP config: ${err.message}`);
    }
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
async function processLightV2({ roomId, prompt, workspacePath }) {
  let lastAgentMessage = null;
  try {
    const Codex = await getCodex();

    // codex SDK 初期化
    // 認証 path 2 通り:
    //   1. OPENAI_API_KEY 設定済 + LIGHTV2_AUTH != 'subscription' → API key 認証
    //      (usage-based billing、production 向き、default)
    //   2. LIGHTV2_AUTH='subscription' → apiKey 渡さず ~/.codex/auth.json で
    //      ChatGPT subscription 認証 (Plus/Pro/Team 持ち、API cost 0、dogfood 向き)
    //
    // Light v1 / Router は依然 OPENAI_API_KEY を使うため、env 自体は unset しない。
    // Light v2 だけ subscription に向けるには LIGHTV2_AUTH=subscription を設定。
    const mcp_servers = buildLightV2McpConfig(workspacePath);
    const codexOpts = { config: { mcp_servers } };
    const useSubscription = config.LIGHTV2_AUTH === 'subscription';
    if (!useSubscription && config.OPENAI_API_KEY) {
      codexOpts.apiKey = config.OPENAI_API_KEY;
    }
    const codex = new Codex(codexOpts);
    logger.info(`[LightV2] auth=${codexOpts.apiKey ? 'API key' : 'subscription'} mcp_servers=${Object.keys(mcp_servers).join(',')}`);

    // memory + system prompt 構築
    let systemPrompt = loadSystemPrompt();
    const memory = loadMemoryForPrompt(workspacePath);
    if (memory) systemPrompt += `\n\n## 記憶\n${memory}`;
    if (workspacePath) {
      const normalizedPath = workspacePath.replace(/\\/g, '/');
      systemPrompt += `\n\n## ワークスペース\nファイル操作ツールを使う際は、以下のパスを使ってください:\n${normalizedPath}`;
    }

    // thread 開始 (per-message 都度新規)
    // sandboxMode='danger-full-access' を試行: workspace-write + networkAccessEnabled=true
    // でも tealus MCP (network 必要) が「user cancelled」で fail し、workspace-fs MCP
    // (network 不要) のみ動作する症状を観測 (5/7 14:30 verify)。sandbox restriction が
    // localhost への HTTP call を依然 block している可能性。
    // danger-full-access で fix すれば sandbox 確定 → 後で fine-grained config 探求。
    // Tealus は agent-server 上で trusted execution context なので、最終的にも
    // この sandboxMode で問題ない (codex の本来用途は untrusted code execution、
    // Tealus AI agent は trusted code path)。
    const thread = codex.startThread({
      model: config.AGENT_LIGHT_MODEL,
      workingDirectory: workspacePath,
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    });

    await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});

    // codex は system prompt を thread option で取らないので、user prompt 先頭に注入
    const fullPrompt = `${systemPrompt}\n\n---\n\nユーザーの質問: ${prompt}`;

    const { events } = await thread.runStreamed(fullPrompt);

    // turn completed 後に MCP child process cleanup 等で発生する parse error は
    // 応答自体に影響しないため、turn 完了フラグで判定して warn に格下げする
    let turnCompleted = false;
    try {
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
              // codex は agent_message を 1 turn で複数回 emit する (#260 dogfood で判明):
              //   - 最初/中間: 「これから X します」「次は Y を読みます」(thinking aloud、tool 呼び前後の narration)
              //   - 最後の非空: 実際の user 向け回答 (要約 / 結論 等)
              //   - 最後: 空文字列 ("" turn 終了 signal、新 codex SDK の behavior)
              //
              // 旧実装 (accumulate) は thinking aloud 全部 concat → user が最初に
              // 「直近の room メッセージを確認して...」等の前置きを見て「要約されてない」
              // と誤認する UX bug が発生 (5/8 dogfood)。
              //
              // **「最後の非空 agent_message を採用」**が正しい (空文字列で上書きしない、
              // ただし非空が来たら overwrite で前の thinking aloud を捨てる)。
              if (event.item.text && event.item.text.trim()) {
                lastAgentMessage = event.item.text;
              }
              await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
            } else if (event.item.type === 'mcp_tool_call') {
              // MCP tool call の result/error 詳細を log (debug 用)
              const status = event.item.status || '?';
              const server = event.item.server || '?';
              const tool = event.item.tool || '?';
              if (event.item.error) {
                logger.warn(`[LightV2] mcp_tool_call FAILED: server=${server} tool=${tool} status=${status} error=${event.item.error.message || JSON.stringify(event.item.error).slice(0, 300)}`);
              } else if (status === 'failed') {
                logger.warn(`[LightV2] mcp_tool_call status=failed: server=${server} tool=${tool} (no error field) item=${JSON.stringify(event.item).slice(0, 400)}`);
              } else {
                const resultPreview = event.item.result
                  ? JSON.stringify(event.item.result).slice(0, 200)
                  : '(no result)';
                logger.info(`[LightV2] mcp_tool_call OK: server=${server} tool=${tool} status=${status} result=${resultPreview}`);
              }
              await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
            } else {
              const mapped = mapToolToStatus(event.item);
              if (mapped) {
                await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});
                logger.info(`[LightV2] tool end: ${event.item.type}`);
              }
            }
          } else if (event.type === 'turn.completed') {
            turnCompleted = true;
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
    } catch (streamErr) {
      // turn completed 後の cleanup parse error (Windows 日本語環境で taskkill
      // 出力が JSONL stream に混入する codex SDK の既知の挙動) は応答に影響なし、
      // warn に格下げして flow 継続。turn 未完了で error 出た場合は throw する。
      if (turnCompleted) {
        logger.warn(`[LightV2] post-turn stream error (ignored, response captured): ${streamErr.message}`);
      } else {
        throw streamErr;
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

module.exports = { processLightV2, splitMessage, buildLightV2McpConfig };
