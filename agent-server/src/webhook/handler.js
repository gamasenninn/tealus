/**
 * Webhookイベントハンドラ
 * 無限ループ防止 + DM/グループ判定
 */
const logger = require('../lib/logger');

// Bot ユーザーIDのキャッシュ（起動時に設定）
const botUserIds = new Set();

/**
 * BotユーザーIDを登録（起動時に呼ばれる）
 */
function registerBotUserId(userId) {
  botUserIds.add(userId);
  logger.info(`Registered bot user: ${userId}`);
}

/**
 * Webhookイベントを処理
 */
async function handleWebhook(payload) {
  const { event } = payload;

  if (event === 'message.created') {
    await handleMessageCreated(payload);
  } else if (event === 'reaction.added') {
    await handleReactionAdded(payload);
  } else {
    logger.debug(`Ignored event: ${event}`);
  }
}

/**
 * message.created イベント処理
 */
async function handleMessageCreated(payload) {
  const { message, room } = payload;

  if (!message || !room) {
    logger.warn('Invalid payload: missing message or room');
    return;
  }

  // 無限ループ防止: Botが送信したメッセージは無視
  const senderId = message.sender?.id;
  if (senderId && botUserIds.has(senderId)) {
    logger.debug(`Skipped bot message from ${senderId}`);
    return;
  }

  logger.info(`Message received: "${(message.content || '(media)').slice(0, 50)}" in room ${room.name || room.id}`);

  // TODO: Phase B で dispatcher.js を実装
  // await dispatch(payload);
}

/**
 * reaction.added イベント処理（承認フロー用、将来拡張）
 */
async function handleReactionAdded(payload) {
  logger.debug(`Reaction: ${payload.reaction?.emoji} on message ${payload.message?.id}`);
  // TODO: Phase C で承認フロー実装
}

module.exports = { handleWebhook, registerBotUserId };
