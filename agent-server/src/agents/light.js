/**
 * Light Agent（OpenAI Agents SDK版）
 * Agent + run() パターンで MCP・ツール・セッション管理に対応
 */
const fs = require('fs');
const path = require('path');
const { Agent, run, codeInterpreterTool } = require('@openai/agents');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { loadMemoryForPrompt } = require('../memory/fileMemory');
const { createTools } = require('./lightTools');
const { getSetting } = require('../context/settingsManager');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

/**
 * システムプロンプトを取得
 * 1. config/system_prompt.md があればそれを使う（カスタム）
 * 2. なければ config/default_system_prompt.md を使う（デフォルト）
 */
function loadSystemPrompt() {
  const customPath = path.join(CONFIG_DIR, 'system_prompt.md');
  const defaultPath = path.join(CONFIG_DIR, 'default_system_prompt.md');
  try {
    if (fs.existsSync(customPath)) {
      const content = fs.readFileSync(customPath, 'utf8').trim();
      if (content) return content;
    }
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf8').trim();
    }
  } catch {}
  return 'あなたはTealusのAIアシスタントです。';
}

/**
 * Light Agent を作成
 */
function createLightAgent(workspacePath, mcpServers = [], roomId = null) {
  const tools = [...createTools(workspacePath, roomId)];
  if (getSetting('tool_code_interpreter', true)) {
    tools.unshift(codeInterpreterTool());
  }

  const agent = new Agent({
    name: 'TealusAssistant',
    instructions: () => {
      let prompt = loadSystemPrompt();
      // ルーム固有 Light プロンプト
      if (workspacePath) {
        const lightPromptPath = path.join(workspacePath, 'light_prompt.md');
        if (fs.existsSync(lightPromptPath)) {
          const roomPrompt = fs.readFileSync(lightPromptPath, 'utf8').trim();
          if (roomPrompt) prompt += `\n\n## ルーム固有の指示\n${roomPrompt}`;
        }
      }
      if (workspacePath && mcpServers.length > 0) {
        const normalizedPath = workspacePath.replace(/\\/g, '/');
        prompt += `\n\n## ワークスペース\nファイル操作ツールを使う際は、以下のワークスペースパスを使ってください:\n${normalizedPath}\n例: ${normalizedPath}/hello.txt`;
      }
      const memory = loadMemoryForPrompt(workspacePath);
      if (memory) {
        prompt += `\n\n## 記憶\n${memory}`;
      }
      logger.debug(`[Light] System prompt: ${prompt.length} chars`);
      return prompt;
    },
    model: config.AGENT_LIGHT_MODEL,
    tools,
    mcpServers,
  });

  // ツール実行時のステータス通知フック
  if (roomId) {
    const TOOL_STATUS_MAP = {
      tavily_search: { status: 'searching', message: '検索中...' },
      code_interpreter: { status: 'calculating', message: '計算中...' },
      generate_image: { status: 'generating', message: '画像生成中...' },
      read_text_file: { status: 'reading', message: 'ファイル読み込み中...' },
      write_text_file: { status: 'writing', message: 'ファイル書き込み中...' },
      list_directory: { status: 'reading', message: 'ディレクトリ読み込み中...' },
    };
    agent.on('agent_tool_start', (ctx, tool) => {
      const mapped = TOOL_STATUS_MAP[tool?.name];
      if (mapped) {
        botApi.pushStatus(roomId, mapped.status, mapped.message).catch(() => {});
      }
    });
  }

  return agent;
}

/**
 * annotations から container_file_citation を抽出して画像を送信
 */
async function sendGeneratedImages(result, roomId) {
  if (!result.newItems) return;

  for (const item of result.newItems) {
    if (item.type !== 'message_output_item') continue;
    const contents = item.rawItem?.content || [];
    for (const c of contents) {
      const annotations = c.providerData?.annotations || c.annotations || [];
      for (const ann of annotations) {
        if (ann.type !== 'container_file_citation') continue;
        try {
          logger.info(`[Image] Downloading: file_id=${ann.file_id}, container_id=${ann.container_id}`);
          const fileResponse = await openai.containers.files.content.retrieve(
            ann.file_id, { container_id: ann.container_id }
          );
          const buffer = Buffer.from(await fileResponse.arrayBuffer());
          const filename = ann.filename || `chart_${Date.now()}.png`;
          await botApi.pushImage(roomId, buffer, filename);
          logger.info(`[Image] Sent to room ${roomId} (${buffer.length} bytes)`);
        } catch (err) {
          logger.error(`[Image] Download/send failed: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Light Agent でメッセージを処理
 */
async function processLight({ roomId, prompt, workspacePath, mcpServers }) {
  try {
    const agent = createLightAgent(workspacePath, mcpServers, roomId);

    // Diagnostic: agent に渡される tools 一覧と MCP servers の状況を log
    try {
      const customToolNames = (agent.tools || []).map(t => t.name || '(unnamed)');
      const mcpInfos = await Promise.all(
        (mcpServers || []).map(async (s) => {
          try {
            const tools = await s.listTools();
            const names = (tools || []).map(t => t.name);
            return `${s.name || '?'}=[${names.join(', ')}]`;
          } catch (e) {
            return `${s.name || '?'}=ERROR(${e.message})`;
          }
        })
      );
      logger.info(`[Light] custom tools: [${customToolNames.join(', ')}], MCP tools: ${mcpInfos.join(' | ')}`);
    } catch (e) {
      logger.warn(`[Light] tool diagnostic failed: ${e.message}`);
    }
    // #230: TealusSession 削除済 (D4 哲学: agent が get_messages で自分で context 取得)
    // session 渡さない = SDK 内部で turn loop は維持、過去 dispatch との連続性は messaging 側で担保

    await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});

    const result = await run(agent, prompt, {
      maxTurns: getSetting('max_turns', config.LIGHT_MAX_TURNS || 3),
    });

    // 使用されたツールをログ
    if (result.newItems) {
      logger.debug(`[Run] newItems: ${result.newItems.length}件`);
      for (const item of result.newItems) {
        const rawType = item.rawItem?.type || '';
        const rawName = item.rawItem?.name || item.rawItem?.call_id || '';
        logger.debug(`[Run] item.type=${item.type}, rawType=${rawType}, rawName=${rawName}`);
        if (item.type === 'tool_call_item') {
          logger.info(`[Tool] 使用: ${rawName || rawType || item.type}`);
        }
      }
    }

    // 生成画像を送信
    await sendGeneratedImages(result, roomId);

    // テキスト応答を送信
    const content = result.finalOutput;
    if (content) {
      if (content.length > 4000) {
        const chunks = splitMessage(content, 4000);
        for (const chunk of chunks) {
          await botApi.pushMessage(roomId, chunk);
        }
      } else {
        await botApi.pushMessage(roomId, content);
      }
      logger.info(`Light response sent to room ${roomId} (${content.length} chars)`);
    }
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
  } catch (err) {
    logger.error(`Light Agent error: ${err.message}`);
    await botApi.pushStatus(roomId, 'idle').catch(() => {});
    try {
      await botApi.pushMessage(roomId, `申し訳ございません。エラーが発生しました: ${err.message}`);
    } catch (pushErr) {
      logger.error(`Failed to send error message: ${pushErr.message}`);
    }
  }
}

/**
 * 長いメッセージを分割
 */
function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  return chunks;
}

module.exports = { processLight, createLightAgent, splitMessage };
