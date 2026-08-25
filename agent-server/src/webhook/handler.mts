/**
 * Webhookイベントハンドラ
 * 無限ループ防止 + DM/グループ判定
 */
import { logger } from '../lib/logger.mts';
import { dispatch } from './dispatcher.mts';
import * as botApi from '../lib/botApi.mts';
import * as inflightRooms from './inflightRooms.mts';
import * as botSendThrottle from '../lib/botSendThrottle.mts';
import { extractCcProjects, findDroppedCcMentions, detectUnroutedAddressHint, appendCcEvent, shouldSkipCcSender, loadSkipSenderIds, emitCcAck } from './ccQueue.mts';
import { isMentioned } from './mention.mts';
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
  } else if (event === 'message.updated') {
    await handleMessageUpdated(payload);
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
 * cc-queue への配送 (#213 / #387 同報)。
 *
 * ★ 配送先ごとに `appendCcEvent` を呼ぶが、**受付エコーは最後に 1 回だけ**出す。
 *   room の status は 1 つしか無いので、宛先ごとに押し込むと上書きし合う (ccQueue.mts 参照)。
 *
 * ★ 1 宛先の append が失敗しても、残りの宛先への配送は続ける。同報の一部が落ちても
 *   全部を落とすより良い (落ちた分は error に残る)。
 *
 * @param targets 実際に beacon を積む先
 * @param recipients 便に載せる「この message の宛先一覧」。編集経路では targets と異なる
 *   (既に届いている班は積み直さないが、受け手には全体像を見せる)
 * @param tag ログの接頭辞 (編集経路は `[edit-trigger]`)
 * @returns 実際に配送できた project 名
 */
function routeCcEvent(
  message: NonNullable<WebhookPayload['message']>,
  room: WebhookRoom,
  targets: string[],
  recipients: string[],
  tag = '',
): string[] {
  const ccPayload = {
    id: message.id,
    room_id: room.id,
    room_name: room.name,
    sender: message.sender,
    content: message.content,
    type: message.type,
    created_at: message.created_at || new Date().toISOString(),
    // #387 受け手が「これは N 班に配られた」と分かる形。無いと 2 班が同じ作業を並行する
    recipients,
  };
  const delivered: string[] = [];
  for (const project of targets) {
    try {
      const filePath = appendCcEvent(project, ccPayload);
      delivered.push(project);
      logger.info(`${tag}[cc-queue] Routed @cc-${project} → ${filePath}`);
    } catch (err) {
      logger.error(`${tag}[cc-queue] Append failed (@cc-${project}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // #335 受付エコー: 「cc-<project> に届きました」を出し TTL 後に消す (一か八か待ち解消)。
  // beacon は既に積んだので best-effort、失敗しても routing 自体は成立している。
  if (delivered.length > 0) {
    emitCcAck({ projects: delivered, roomId: room.id, pushStatus: botApi.pushStatus });
  }
  return delivered;
}

/**
 * #386 行頭に書かれているのに配送しなかった宛先を warn に出す (黙って捨てない)。
 *
 * 2026-08-23 の実害は「3 班宛のつもりが 1 班にしか届かず、**送った側も受け取らなかった側も
 * 気づかなかった**」。配送の挙動は #387 で直したが、**1 行目の先頭以外に書かれた宛先は
 * 今も配送しない** (引用・案内表で無関係なセッションを起こさないため) ので、
 * そちらは宣言する。
 */
function warnDroppedCcMentions(
  content: string | null | undefined,
  delivered: string[],
  room: WebhookRoom,
  senderId: string | undefined,
): void {
  const dropped = findDroppedCcMentions(content, delivered);
  if (dropped.length === 0) return;
  logger.warn(
    `[cc-queue] 1 行目の先頭以外にある宛先には配送していません: `
    + `配送先=${delivered.join(',') || '(なし)'} 未配送=${dropped.join(',')} `
    + `room=${room.name || room.id} sender=${senderId || '?'}。`
    + `同報するときは 1 行目の先頭に @cc-a @cc-b と並べてください`,
  );
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
  // #387: 1 行目の先頭に並べた宛先 (`@cc-a @cc-b`) は全部に配る (同報)。
  // Bot membership 検証より前に実行 (cc routing は agent-server の Light/Deep dispatch とは独立)。
  const ccProjects = extractCcProjects(message.content);
  if (ccProjects.length > 0) {
    if (shouldSkipCcSender(senderId, ccSkipSenderIds)) {
      // #213 Phase A polish: Claude Code session 等の cc bot からの @cc-* 言及は self-loop の元。skip。
      logger.debug(`[cc-queue] Skipped self-loop sender ${senderId} for @cc-${ccProjects.join(' @cc-')}`);
    } else {
      const delivered = routeCcEvent(message, room, ccProjects, ccProjects);
      warnDroppedCcMentions(message.content, delivered, room, senderId);
    }
    // continue: dispatch にも通す (bot が同 message に @mention されてれば応答)
  } else {
    // #359 (a): 宛先を書いたつもりで配送されなかった便を可視化する。
    // 2026-08-20 の実害は「3 日間どこにも届かず、痕跡も残らなかった」。
    // ★ silent をやめるだけで 3 日は 1 時間になっていた (issue の選択肢 6)。
    // 精度優先で拾うので info。全件を上げると通常の会話に埋もれて「見えない」に戻る。
    const hint = detectUnroutedAddressHint(message.content);
    if (hint) {
      const head = (message.content || '').split('\n').find(l => l.trim().length > 0) || '';
      logger.info(`[cc-queue] 宛先未解決のため配送していません (${hint}): `
        + `room=${room.name || room.id} sender=${message.sender?.display_name || senderId} head="${head.slice(0, 60)}"`);
    }
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
 * message.updated イベント処理 (#338 Phase 2: 編集トリガー)
 *
 * 「呼び忘れても、編集で @mention を書き足すだけで届く」を実現する。
 * 送信済みメッセージを編集して **先頭 mention を新規に付けた時だけ** 起動する。
 *
 * 非自明な不変条件:
 * - **新規付与時のみ** (`isMentioned(now) && !isMentioned(prev)`)。既に付いていれば発火しない
 *   = 本文だけ再編集しても再応答しない (一度きり)。
 * - **編集者 = 元の投稿者** の時だけ (他人の投稿を勝手に召喚しない)。
 * - bot 自身の編集は skip (self-loop 防止)。
 * サーバは message.updated webhook に previous_content / edited_by を載せている
 * (server/src/routes/messages.mts)。
 */
async function handleMessageUpdated(payload: WebhookPayload): Promise<void> {
  const { message, room } = payload;

  if (!message || !room) {
    logger.warn('Invalid payload: missing message or room');
    return;
  }

  const content = message.content;
  const prevContent = message.previous_content;
  const senderId = message.sender?.id;
  const editorId = message.edited_by?.id;

  // 編集者 = 元の投稿者 の時だけ (他人編集での召喚を防ぐ)
  if (!senderId || !editorId || senderId !== editorId) {
    logger.debug('[edit-trigger] Skipped: editor is not the original sender');
    return;
  }
  // bot 自身の編集は self-loop の元 → skip
  if (botUserIds.has(senderId)) {
    logger.debug(`[edit-trigger] Skipped bot self-edit from ${senderId}`);
    return;
  }

  // cc-queue: 編集で @cc-<project> が新規に付いたら beacon 追記 (cc-bridge の呼び忘れ救済)
  // ★ #387: 宛先が複数になったので「付いたか / 付いていないか」の真偽値ではなく **差分**で見る。
  //   既に届いている班へ積み直すと、同じ便で 2 回起こすことになる。
  const ccNow = extractCcProjects(content);
  const ccPrev = new Set(extractCcProjects(prevContent));
  const ccAdded = ccNow.filter((p) => !ccPrev.has(p));
  if (ccAdded.length > 0 && !shouldSkipCcSender(senderId, ccSkipSenderIds)) {
    routeCcEvent(message, room, ccAdded, ccNow, '[edit-trigger]');
  }

  // アシスタント: 編集で @<assistant> が新規に付いたら dispatch (アシスタントの呼び忘れ救済)
  const mentionNow = isMentioned(content, botAgentName);
  const mentionPrev = isMentioned(prevContent, botAgentName);
  if (!(mentionNow && !mentionPrev)) return;

  // Bot が参加していないルームは無視 (handleMessageCreated と同型に再取得して確認)
  if (botRoomIds.size > 0 && !botRoomIds.has(room.id)) {
    try {
      const roomData = await botApi.getRooms();
      const rooms = roomData.rooms || [];
      botRoomIds.clear();
      rooms.forEach((r: { id: string }) => botRoomIds.add(r.id));
      if (!botRoomIds.has(room.id)) {
        logger.debug(`[edit-trigger] Skipped: bot not member of room ${room.name || room.id}`);
        return;
      }
    } catch {
      logger.debug(`[edit-trigger] Skipped: bot not member of room ${room.name || room.id}`);
      return;
    }
  }

  logger.info(`[edit-trigger] Mention newly added via edit in room ${room.name || room.id} → dispatch`);
  await dispatch({
    message: { ...message, type: message.type || 'text' },
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
