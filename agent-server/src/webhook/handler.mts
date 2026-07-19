/**
 * Webhookイベントハンドラ
 * 無限ループ防止 + DM/グループ判定
 */
import { logger } from '../lib/logger.mts';
import { dispatch } from './dispatcher.mts';
import * as botApi from '../lib/botApi.mts';
import * as inflightRooms from './inflightRooms.mts';
import * as botSendThrottle from '../lib/botSendThrottle.mts';
import { extractCcProject, appendCcEvent, shouldSkipCcSender, loadSkipSenderIds, emitCcAck } from './ccQueue.mts';
import type { WebhookPayload, WebhookRoom } from '../types.mts';

// #213 Phase A polish: 自己ループ防止用 sender skip set (env CC_SKIP_SENDER_IDS、CSV)
const ccSkipSenderIds = loadSkipSenderIds();

// Bot ユーザーIDのキャッシュ（起動時に設定）
const botUserIds = new Set<string>();
const botRoomIds = new Set<string>(); // Bot が参加しているルームID
let botAgentId: string | null = null;
let botAgentName: string | null = null;

/**
 * BotユーザーIDを登録（起動時に呼ばれる）
 */
export function registerBotUserId(userId: string, displayName?: string, rooms: Array<{ id: string }> = []): void {
  botUserIds.add(userId);
  botAgentId = userId;
  botAgentName = displayName || 'AI';
  rooms.forEach(r => botRoomIds.add(r.id));
  logger.info(`Registered bot user: ${userId} (${botAgentName}), ${botRoomIds.size} rooms`);
}

/**
 * アプリ内アシスタントの identity を返す (#338 Phase 1)。
 * クライアントの compose ヘルパーが正しい宛先メンション (@<display_name>) を
 * 組み立てるのに使う。起動時の registerBotUserId で確定するため、未登録なら null。
 */
export function getBotIdentity(): { user_id: string | null; display_name: string | null } {
  return { user_id: botAgentId, display_name: botAgentName };
}

/**
 * Bot の参加ルーム一覧を更新
 */
export function updateBotRooms(rooms: Array<{ id: string }>): void {
  botRoomIds.clear();
  rooms.forEach(r => botRoomIds.add(r.id));
}

/**
 * Webhookイベントを処理
 */
export async function handleWebhook(payload: WebhookPayload): Promise<void> {
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
async function handleMessageCreated(payload: WebhookPayload): Promise<void> {
  const { message, room } = payload;

  if (!message || !room) {
    logger.warn('Invalid payload: missing message or room');
    return;
  }

  // 無限ループ防止: Botが送信したメッセージは無視
  // #292 SPIKE (ENABLE_CROSS_ROOM_DELEGATION=true): in-flight tracking で
  //   同 room 自送 echo は block、別 room delegation post は通す。
  //   safety net: botSendThrottle.isSpikeTripped 時は runtime で旧挙動 fallback。
  //   暴走時は env=false で旧挙動 / サーバー停止で kill。
  const senderId = message.sender?.id;
  if (senderId && botUserIds.has(senderId)) {
    const spikeOff = process.env.ENABLE_CROSS_ROOM_DELEGATION !== 'true' || botSendThrottle.isSpikeTripped();
    if (spikeOff) {
      logger.debug(`Skipped bot message from ${senderId}`);
      return;
    }
    if (inflightRooms.isInflight(room.id)) {
      logger.debug(`[SPIKE] Skipped same-room bot echo: ${senderId} in ${room.name || room.id}`);
      return;
    }
    logger.info(`[SPIKE] cross-room delegation accepted: ${senderId} in ${room.name || room.id}`);
  }

  // #213 Phase A: cc-queue routing — `@cc-{project}` mention を file beacon に追記。
  // Bot membership 検証より前に実行 (cc routing は agent-server の Light/Deep dispatch とは独立)。
  const ccProject = extractCcProject(message.content);
  if (ccProject) {
    if (shouldSkipCcSender(senderId, ccSkipSenderIds)) {
      // #213 Phase A polish: Claude Code session 等の cc bot からの @cc-* 言及は self-loop の元。skip。
      logger.debug(`[cc-queue] Skipped self-loop sender ${senderId} for @cc-${ccProject}`);
    } else {
      try {
        const ccPayload = {
          id: message.id,
          room_id: room.id,
          room_name: room.name,
          sender: message.sender,
          content: message.content,
          type: message.type,
          created_at: message.created_at || new Date().toISOString(),
        };
        const filePath = appendCcEvent(ccProject, ccPayload);
        logger.info(`[cc-queue] Routed @cc-${ccProject} → ${filePath}`);
        // #335 受付エコー: 「cc-<project> に届きました」を出し TTL 後に消す (一か八か待ち解消)。
        // beacon は既に積んだので best-effort、失敗しても routing 自体は成立している。
        emitCcAck({ project: ccProject, roomId: room.id, pushStatus: botApi.pushStatus });
      } catch (err) {
        logger.error(`[cc-queue] Append failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // continue: dispatch にも通す (bot が同 message に @mention されてれば応答)
  }

  // Bot が参加していないルームは無視（ただしルーム一覧を再取得して確認）
  if (botRoomIds.size > 0 && !botRoomIds.has(room.id)) {
    try {
      const roomData = await botApi.getRooms();
      const rooms = roomData.rooms || [];
      botRoomIds.clear();
      rooms.forEach((r: { id: string }) => botRoomIds.add(r.id));
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
async function handleTranscriptionCompleted(payload: WebhookPayload): Promise<void> {
  const { message, room, transcription } = payload;

  if (!message || !room) {
    logger.warn('Invalid transcription payload');
    return;
  }

  // #292 SPIKE: bot transcription も message と同条件 (in-flight + spike trip 両判定)
  const senderId = message.sender?.id;
  if (senderId && botUserIds.has(senderId)) {
    const spikeOff = process.env.ENABLE_CROSS_ROOM_DELEGATION !== 'true' || botSendThrottle.isSpikeTripped();
    if (spikeOff) {
      logger.debug(`Skipped bot transcription from ${senderId}`);
      return;
    }
    if (inflightRooms.isInflight(room.id)) {
      logger.debug(`[SPIKE] Skipped same-room bot transcription echo: ${senderId} in ${room.id}`);
      return;
    }
    logger.info(`[SPIKE] cross-room delegation transcription accepted: ${senderId} in ${room.id}`);
  }

  if (botRoomIds.size > 0 && !botRoomIds.has(room.id)) {
    try {
      const roomData = await botApi.getRooms();
      const rooms = roomData.rooms || [];
      botRoomIds.clear();
      rooms.forEach((r: { id: string }) => botRoomIds.add(r.id));
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
function handleMemberJoined(payload: WebhookPayload): void {
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
function handleMemberLeft(payload: WebhookPayload): void {
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
async function handleReactionAdded(payload: WebhookPayload): Promise<void> {
  logger.debug(`Reaction: ${payload.reaction?.emoji} on message ${payload.message?.id}`);
  // TODO: Phase C で承認フロー実装
}
