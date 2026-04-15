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
const { getOrCreateRoomMcp } = require('../mcp/roomMcpManager');
const { extractPromptFromMessage } = require('../media/messageAdapter');
const fs = require('fs');
const path = require('path');

// ルームごとの処理キュー（並行実行防止）
const roomQueues = new Map();

async function enqueueForRoom(roomId, fn) {
  const prev = roomQueues.get(roomId) || Promise.resolve();
  const next = prev.then(fn).catch(err => logger.error(`Queue error: ${err.message}`));
  roomQueues.set(roomId, next);
  await next;
}

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

  // ルームごとにシリアライズ（並行実行防止）
  await enqueueForRoom(roomId, () => _dispatch({ message, room, agentId, agentName }));
}

async function _dispatch({ message, room, agentId, agentName }) {
  const roomId = room.id;
  const memberCount = room.member_count || 2;

  // メッセージタイプに応じてプロンプトを抽出
  let prompt = extractPromptFromMessage(message);
  if (!prompt) {
    logger.debug(`Skipped: empty prompt (type: ${message.type})`);
    return;
  }

  // コンテキスト取得/作成
  const context = await getOrCreateContext(agentId, roomId);

  // ルーム設定を読み込み（response_mode）
  let roomSettings = { response_mode: 'auto', enabled: true };
  const roomSettingsPath = path.join(context.workspace_path, 'room_settings.json');
  if (fs.existsSync(roomSettingsPath)) {
    try { roomSettings = JSON.parse(fs.readFileSync(roomSettingsPath, 'utf8')); } catch {}
  }

  // エージェント無効
  if (!roomSettings.enabled || roomSettings.response_mode === 'off') {
    logger.debug(`Skipped: agent disabled in room ${room.name || roomId}`);
    return;
  }

  // 応答モードに応じたメンション判定
  const needsMention =
    roomSettings.response_mode === 'mention' ? true :
    roomSettings.response_mode === 'all' ? false :
    /* auto */ memberCount > 2;

  if (needsMention) {
    if (!isMentioned(prompt, agentName)) {
      logger.debug(`Skipped: no mention in ${room.name || roomId}`);
      return;
    }
    prompt = extractPrompt(prompt, agentName);
  }

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
        const mcpServers = await getOrCreateRoomMcp(agentId, roomId, context.workspace_path);
        await processLight({
          roomId,
          prompt: result.prompt || prompt,
          workspacePath: context.workspace_path,
          mcpServers,
        });
      } finally {
        await updateStatus(agentId, roomId, 'idle');
      }
      break;

    case 'deep':
      // Deep Agent（claude -p）
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
