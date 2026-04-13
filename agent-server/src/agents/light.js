/**
 * Light Agent（OpenAI Agents SDK版）
 * Agent + run() パターンで MCP・ツール・セッション管理に対応
 */
const { Agent, run, webSearchTool, RunHooks } = require('@openai/agents');
const config = require('../config');
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { loadMemoryForPrompt } = require('../memory/fileMemory');
const { TealusSession } = require('./lightSession');
const { createTools } = require('./lightTools');

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
function createLightAgent(workspacePath, mcpServers = []) {
  const tools = [webSearchTool(), ...createTools(workspacePath)];

  return new Agent({
    name: 'TealusAssistant',
    instructions: () => {
      let prompt = SYSTEM_PROMPT;
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
}

/**
 * Light Agent でメッセージを処理
 */
async function processLight({ roomId, prompt, workspacePath, mcpServers }) {
  try {
    const agent = createLightAgent(workspacePath, mcpServers);
    const session = new TealusSession(roomId);

    const result = await run(agent, prompt, {
      session,
      maxTurns: config.LIGHT_MAX_TURNS || 10,
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
    } else {
      logger.debug(`[Run] newItems is undefined/null`);
    }

    const content = result.finalOutput;
    if (content) {
      // 長い応答は分割
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
  } catch (err) {
    logger.error(`Light Agent error: ${err.message}`);
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
