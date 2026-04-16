/**
 * Webhookイベントハンドラ
 * 無限ループ防止 + DM/グループ判定
 */
const logger = require('../lib/logger');
const { dispatch } = require('./dispatcher');

// Bot ユーザーIDのキャッシュ（起動時に設定）
const botUserIds = new Set();
const botRoomIds = new Set(); // Bot が参加しているルームID
let botAgentId = null;
let botAgentName = null;

/**
 * BotユーザーIDを登録（起動時に呼ばれる）
 */
function registerBotUserId(userId, displayName, rooms = []) {
  botUserIds.add(userId);
  botAgentId = userId;
  botAgentName = displayName || 'AI';
  rooms.forEach(r => botRoomIds.add(r.id));
  logger.info(`Registered bot user: ${userId} (${botAgentName}), ${botRoomIds.size} rooms`);
}

/**
 * Bot の参加ルーム一覧を更新
 */
function updateBotRooms(rooms) {
  botRoomIds.clear();
  rooms.forEach(r => botRoomIds.add(r.id));
}

/**
 * Webhookイベントを処理
 */
async function handleWebhook(payload) {
  const { event } = payload;

  if (event === 'message.created') {
    await handleMessageCreated(payload);
  } else if (event === 'voice.transcription_completed') {
    await handleTranscriptionCompleted(payload);
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

  // Bot が参加していないルームは無視
  if (botRoomIds.size > 0 && !botRoomIds.has(room.id)) {
    logger.debug(`Skipped: bot not member of room ${room.name || room.id}`);
    return;
  }

  // 音声メッセージは voice.transcription_completed で処理する
  if (message.type === 'voice') {
    logger.debug('Skipped voice message (waiting for transcription_completed)');
    return;
  }

  logger.info(`Message received: "${(message.content || '(media)').slice(0, 50)}" in room ${room.name || room.id}`);

  // ディスパッチ
  await dispatch({
    message,
    room,
    agentId: botAgentId,
    agentName: botAgentName,
  });
}

/**
 * voice.transcription_completed イベント処理
 * 音声メッセージの文字起こし完了時に呼ばれる
 */
async function handleTranscriptionCompleted(payload) {
  const { message, room, transcription } = payload;

  if (!message || !room) {
    logger.warn('Invalid transcription payload');
    return;
  }

  const senderId = message.sender?.id;
  if (senderId && botUserIds.has(senderId)) {
    logger.debug(`Skipped bot transcription from ${senderId}`);
    return;
  }

  if (botRoomIds.size > 0 && !botRoomIds.has(room.id)) {
    logger.debug(`Skipped transcription: bot not member of room ${room.id}`);
    return;
  }

  const text = transcription?.formatted_text || transcription?.raw_text;
  logger.info(`Transcription completed: "${(text || '').slice(0, 50)}" in room ${room.id}`);

  // 文字起こしテキスト付きでディスパッチ
  await dispatch({
    message: { ...message, content: text, transcription },
    room,
    agentId: botAgentId,
    agentName: botAgentName,
  });
}

/**
 * reaction.added イベント処理（承認フロー用、将来拡張）
 */
async function handleReactionAdded(payload) {
  logger.debug(`Reaction: ${payload.reaction?.emoji} on message ${payload.message?.id}`);
  // TODO: Phase C で承認フロー実装
}

module.exports = { handleWebhook, registerBotUserId, updateBotRooms };
