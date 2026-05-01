/**
 * Webhookイベントハンドラ
 * 無限ループ防止 + DM/グループ判定
 */
const logger = require('../lib/logger');
const { dispatch } = require('./dispatcher');
const botApi = require('../lib/botApi');
const { extractCcProject, appendCcEvent } = require('./ccQueue');

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
  } else if (event === 'member.joined') {
    handleMemberJoined(payload);
  } else if (event === 'member.left') {
    handleMemberLeft(payload);
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

  // #213 Phase A: cc-queue routing — `@cc-{project}` mention を file beacon に追記。
  // Bot membership 検証より前に実行 (cc routing は agent-server の Light/Deep dispatch とは独立)。
  const ccProject = extractCcProject(message.content);
  if (ccProject) {
    try {
      const ccPayload = {
        id: message.id,
        room_id: room.id,
        room_name: room.name,
        sender: message.sender,
        content: message.content,
        type: message.type,
        created_at: message.created_at,
      };
      const filePath = appendCcEvent(ccProject, ccPayload);
      logger.info(`[cc-queue] Routed @cc-${ccProject} → ${filePath}`);
    } catch (err) {
      logger.error(`[cc-queue] Append failed: ${err.message}`);
    }
    // continue: dispatch にも通す (bot が同 message に @mention されてれば応答)
  }

  // Bot が参加していないルームは無視（ただしルーム一覧を再取得して確認）
  if (botRoomIds.size > 0 && !botRoomIds.has(room.id)) {
    try {
      const roomData = await botApi.getRooms();
      const rooms = roomData.rooms || [];
      botRoomIds.clear();
      rooms.forEach(r => botRoomIds.add(r.id));
      if (!botRoomIds.has(room.id)) {
        logger.debug(`Skipped: bot not member of room ${room.name || room.id}`);
        return;
      }
      logger.info(`Bot room list refreshed, now includes ${room.name || room.id}`);
    } catch {
      logger.debug(`Skipped: bot not member of room ${room.name || room.id}`);
      return;
    }
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
    try {
      const roomData = await botApi.getRooms();
      const rooms = roomData.rooms || [];
      botRoomIds.clear();
      rooms.forEach(r => botRoomIds.add(r.id));
      if (!botRoomIds.has(room.id)) {
        logger.debug(`Skipped transcription: bot not member of room ${room.id}`);
        return;
      }
    } catch {
      logger.debug(`Skipped transcription: bot not member of room ${room.id}`);
      return;
    }
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
 * member.joined イベント処理
 * Bot 自身がルームに追加された場合、botRoomIds を更新
 */
function handleMemberJoined(payload) {
  const { room, member } = payload;
  const memberId = member?.user_id || member?.id;
  if (memberId && botUserIds.has(memberId) && room?.id) {
    botRoomIds.add(room.id);
    logger.info(`Bot joined room: ${room.name || room.id}`);
  }
}

/**
 * member.left イベント処理
 * Bot 自身がルームから退出した場合、botRoomIds を更新
 */
function handleMemberLeft(payload) {
  const { room, member } = payload;
  const memberId = member?.user_id || member?.id;
  if (memberId && botUserIds.has(memberId) && room?.id) {
    botRoomIds.delete(room.id);
    logger.info(`Bot left room: ${room.name || room.id}`);
  }
}

/**
 * reaction.added イベント処理（承認フロー用、将来拡張）
 */
async function handleReactionAdded(payload) {
  logger.debug(`Reaction: ${payload.reaction?.emoji} on message ${payload.message?.id}`);
  // TODO: Phase C で承認フロー実装
}

module.exports = { handleWebhook, registerBotUserId, updateBotRooms };
