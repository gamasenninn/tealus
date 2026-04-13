/**
 * Dispatcher
 * DM/グループ判定 → メンション検知 → Router → Light/Deep 振り分け
 */
const logger = require('../lib/logger');
const botApi = require('../lib/botApi');
const { route } = require('../router/index');
const { processLight } = require('../agents/light');
const { processDeep } = require('../agents/deep');
const { getOrCreateContext, updateStatus } = require('../context/sessionManager');
const { getConnectedServers } = require('../mcp/manager');
const { extractPromptFromMessage } = require('../media/messageAdapter');

/**
 * @メンションを検知
 */
function isMentioned(content, agentName) {
  const pattern = new RegExp(`@${agentName}`, 'i');
  return pattern.test(content);
}

/**
 * メンション部分を除去してプロンプトを抽出
 */
function extractPrompt(content, agentName) {
  const pattern = new RegExp(`@${agentName}\\s*`, 'gi');
  return content.replace(pattern, '').trim();
}

/**
 * メッセージをディスパッチ
 */
async function dispatch({ message, room, agentId, agentName }) {
  const roomId = room.id;
  const memberCount = room.member_count || 2;

  // メッセージタイプに応じてプロンプトを抽出
  let prompt = extractPromptFromMessage(message);
  if (!prompt) {
    logger.debug(`Skipped: empty prompt (type: ${message.type})`);
    return;
  }

  // グループ（3名以上）はメンション時のみ応答
  if (memberCount > 2) {
    if (!isMentioned(prompt, agentName)) {
      logger.debug(`Skipped: no mention in group ${room.name || roomId}`);
      return;
    }
    prompt = extractPrompt(prompt, agentName);
  }

  // コンテキスト取得/作成
  const context = await getOrCreateContext(agentId, roomId);

  // Router で振り分け
  const result = await route(prompt);

  switch (result.tier) {
    case 'router':
      // Router直接応答（挨拶等）
      await botApi.pushMessage(roomId, result.response);
      logger.info(`Router direct: "${result.response.slice(0, 30)}..." → room ${roomId}`);
      break;

    case 'light':
      // Light Agent
      await updateStatus(agentId, roomId, 'processing');
      try {
        await processLight({
          roomId,
          prompt: result.prompt || prompt,
          workspacePath: context.workspace_path,
          mcpServers: getConnectedServers(),
        });
      } finally {
        await updateStatus(agentId, roomId, 'idle');
      }
      break;

    case 'deep':
      // Deep Agent（claude -p）
      await botApi.pushMessage(roomId, '🔍 高度な分析を開始します。少しお時間をいただきます...');
      await updateStatus(agentId, roomId, 'processing');
      try {
        await processDeep({
          roomId,
          prompt: result.prompt || prompt,
          workspacePath: context.workspace_path,
          agentId,
          sessionId: context.session_id,
        });
      } finally {
        await updateStatus(agentId, roomId, 'idle');
      }
      break;

    default:
      logger.warn(`Unknown tier: ${result.tier}`);
  }
}

module.exports = { isMentioned, extractPrompt, dispatch };
