/**
 * Light Agent（OpenAI Agents SDK版）
 * Agent + run() パターンで MCP・ツール・セッション管理に対応
 */
const { Agent, run, codeInterpreterTool } = require('@openai/agents');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { loadMemoryForPrompt } = require('../memory/fileMemory');
const { TealusSession } = require('./lightSession');
const { createTools } = require('./lightTools');
const { getSetting } = require('../context/settingsManager');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const SYSTEM_PROMPT = `あなたはTealusのAIアシスタントです。
社内メッセンジャー上でチームメンバーとして対等に会話します。

## ルール
- 簡潔で自然な日本語で応答してください
- 質問には正確に答え、わからない場合は正直に伝えてください
- 天気、ニュース、最新情報などリアルタイム情報が必要な場合はWeb検索ツールを積極的に使ってください
- ユーザーの情報は write_memory ツールで保存し、次回以降に活用してください
- 現在の日時が必要な場合は get_current_time ツールを使ってください
- 複雑すぎるタスクは「このタスクは高度な分析が必要です」と伝えてください`;

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
      let prompt = getSetting('system_prompt', '') || SYSTEM_PROMPT;
      if (workspacePath && mcpServers.length > 0) {
        const normalizedPath = workspacePath.replace(/\\/g, '/');
        prompt += `\n\n## ワークスペース\nファイル操作ツールを使う際は、以下のワークスペースパスを使ってください:\n${normalizedPath}\n例: ${normalizedPath}/hello.txt`;
      }
      const memory = loadMemoryForPrompt(workspacePath);
      if (memory) {
        prompt += `\n\n## 記憶\n${memory}`;
      }
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
    const session = new TealusSession(roomId);

    await botApi.pushStatus(roomId, 'thinking', '考え中...').catch(() => {});

    const result = await run(agent, prompt, {
      session,
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
