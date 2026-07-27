/**
 * LINE → Tealus post helper
 *
 * LINE webhook で受信した message を Tealus DB に post する helper 群。
 * core SQL pattern は既存 `routes/bot.js` /push-image + `routes/voice.js` から流用、
 * LINE webhook 用 entry point として独立提供 (= Phase 1 では duplicate copy、Phase 2 で
 * 共通 helper 抽出 refactor 想定)。
 *
 * 関連:
 *   - LINE Bridge Phase 1 (= 本日 Day 17 起票予定)
 *   - 既存 reference: routes/bot.js /push-image (line 238-315)、routes/voice.js (line 56-126)
 *   - voice の transcription trigger = `services/transcription.js`
 *
 * @module services/lineMessageBridge
 */
import type { Server } from 'socket.io';
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';
import type { AuthUser } from '../types.mts';
import type { SavedLineContent } from './lineBridge.mts';
import { transcribeVoiceMessage } from './transcription.mts';
import { generateThumbnail } from './thumbnail.mts';

// ★ ★ Option D refactor (= Day 21 PM): sender info は ★ ★ ★ helper 内で query せず、
// ★ ★ caller (= routes/line.js dispatchEvent) で context object として渡される。
// ★ socket/handlers/message.js (= socket.user) + routes/bot.js (= req.user) + routes/voice.js と 1:1 整合。
// helper 内 DB query ゼロ + module level state ゼロ = test isolation 構造的保証。
// sender = { id, display_name, avatar_url } object form
export type LineSenderContext = Pick<AuthUser, 'id' | 'display_name' | 'avatar_url'>;

/** messages テーブル row (= INSERT ... RETURNING *) */
export interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  reply_to: string | null;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

/** message_media テーブル row (= INSERT ... RETURNING *、BIGINT は pg が string で返す) */
export interface MediaRow {
  id: string;
  message_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: string;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
  created_at: Date;
}

/** media 系 post helper の共通 params */
interface PostMediaParams {
  roomId: string;
  sender: LineSenderContext;
  mediaInfo: SavedLineContent;
  content?: string | null;
  replyTo?: string | null;
  io?: Server | null;
}

/**
 * text message を Tealus に post
 *
 * @param params.roomId
 * @param params.sender - sender context object (= { id, display_name, avatar_url }、socket.user / req.user 同型)
 * @param params.content - LINE message.text
 * @param params.replyTo
 * @param params.io - Socket.IO instance (= broadcast、optional)
 */
export async function postTextToTealus(
  { roomId, sender, content, replyTo, io }: {
    roomId: string;
    sender: LineSenderContext;
    content: string;
    replyTo?: string | null;
    io?: Server | null;
  }
): Promise<{ message: MessageRow }> {
  if (!roomId) throw new Error('roomId is required');
  if (!sender) throw new Error('sender is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, 'text', $4) RETURNING *`,
      [roomId, sender.id, content || '', replyTo || null]
    );
    const message = msgResult.rows[0];
    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', {
        ...message,
        sender_display_name: sender.display_name,
        sender_avatar_url: sender.avatar_url,
      });
    }

    logger.info(`[lineMessageBridge] text post: room=${roomId} msg=${message.id}`);
    return { message };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * image message を Tealus に post
 *
 * @param params.roomId
 * @param params.sender
 * @param params.mediaInfo - lineBridge.saveLineContentToFile の return value
 * @param params.content
 * @param params.replyTo
 * @param params.io
 */
export async function postImageToTealus(
  { roomId, sender, mediaInfo, content, replyTo, io }: PostMediaParams
): Promise<{ message: MessageRow; media: MediaRow }> {
  if (!roomId) throw new Error('roomId is required');
  if (!sender) throw new Error('sender is required');
  if (!mediaInfo) throw new Error('mediaInfo is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, 'image', $4) RETURNING *`,
      [roomId, sender.id, content || null, replyTo || null]
    );
    const message = msgResult.rows[0];

    // image dimensions (= bot.js /push-image 同型、sharp metadata、失敗時は null で続行)
    let width: number | null = null;
    let height: number | null = null;
    try {
      const { default: sharp } = await import('sharp');
      const metadata = await sharp(mediaInfo.filePath).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    } catch (e) {
      logger.warn(`[lineMessageBridge] sharp metadata failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const mediaResult = await client.query<MediaRow>(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [message.id, mediaInfo.relativePath, mediaInfo.fileName, mediaInfo.mimeType, mediaInfo.fileSize, width, height]
    );
    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', {
        ...message,
        sender_display_name: sender.display_name,
        sender_avatar_url: sender.avatar_url,
        media: [mediaResult.rows[0]],
      });
    }

    logger.info(`[lineMessageBridge] image post: room=${roomId} msg=${message.id} file=${mediaInfo.fileName}`);
    return { message, media: mediaResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 複数 image を 1 メッセージに束ねて Tealus に post (#353 imageSet 用)
 *
 * routes/media.mts のマルチアップロード同型 (= 1 message + N message_media 行)。
 * mediaInfos は caller 側で imageSet.index 昇順ソート済みの前提 (= lineImageSetBuffer が保証)。
 *
 * @param params.roomId
 * @param params.sender
 * @param params.mediaInfos - 保存済みメディア配列 (1 枚以上)
 * @param params.content - sender label (= applyContentLabel 済)
 * @param params.io
 */
export async function postImagesToTealus(
  { roomId, sender, mediaInfos, content, io }: {
    roomId: string;
    sender: LineSenderContext;
    mediaInfos: SavedLineContent[];
    content?: string;
    io?: Server | null;
  }
): Promise<{ message: MessageRow; media: MediaRow[] }> {
  if (!roomId) throw new Error('roomId is required');
  if (!sender) throw new Error('sender is required');
  if (!mediaInfos || mediaInfos.length === 0) throw new Error('mediaInfos is required (non-empty)');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES ($1, $2, $3, 'image') RETURNING *`,
      [roomId, sender.id, content || null]
    );
    const message = msgResult.rows[0];

    const media: MediaRow[] = [];
    for (const mediaInfo of mediaInfos) {
      // image dimensions (= postImageToTealus 同型、失敗時は null で続行)
      let width: number | null = null;
      let height: number | null = null;
      try {
        const { default: sharp } = await import('sharp');
        const metadata = await sharp(mediaInfo.filePath).metadata();
        width = metadata.width || null;
        height = metadata.height || null;
      } catch (e) {
        logger.warn(`[lineMessageBridge] sharp metadata failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      const mediaResult = await client.query<MediaRow>(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [message.id, mediaInfo.relativePath, mediaInfo.fileName, mediaInfo.mimeType, mediaInfo.fileSize, width, height]
      );
      media.push(mediaResult.rows[0]);
    }
    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', {
        ...message,
        sender_display_name: sender.display_name,
        sender_avatar_url: sender.avatar_url,
        media,
      });
    }

    logger.info(`[lineMessageBridge] image-set post: room=${roomId} msg=${message.id} files=${media.length}`);
    return { message, media };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * voice message を Tealus に post (= voice.js 同型 + transcribeVoiceMessage 自動 trigger)
 *
 * @param params.roomId
 * @param params.sender
 * @param params.mediaInfo - lineBridge.saveLineContentToFile の return value
 * @param params.content - caption (= #309 案A の sender label 等、null 可)
 * @param params.replyTo
 * @param params.io
 */
export async function postVoiceToTealus(
  { roomId, sender, mediaInfo, content, replyTo, io }: PostMediaParams
): Promise<{ message: MessageRow; media: MediaRow }> {
  if (!roomId) throw new Error('roomId is required');
  if (!sender) throw new Error('sender is required');
  if (!mediaInfo) throw new Error('mediaInfo is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, 'voice', $4) RETURNING *`,
      [roomId, sender.id, content || null, replyTo || null]
    );
    const message = msgResult.rows[0];

    const mediaResult = await client.query<MediaRow>(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [message.id, mediaInfo.relativePath, mediaInfo.fileName, mediaInfo.mimeType, mediaInfo.fileSize]
    );

    // pending transcription record (= voice.js 同型)
    await client.query(
      `INSERT INTO voice_transcriptions (message_id, status) VALUES ($1, 'pending')`,
      [message.id]
    );

    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', {
        ...message,
        sender_display_name: sender.display_name,
        sender_avatar_url: sender.avatar_url,
        media: [mediaResult.rows[0]],
      });
    }

    // ★ ★ ★ Background transcription trigger (= voice.js line 116-118 同型)
    // organon polyseme inject (= 5/31 Day 15 完成) もここから自動連動
    try {
      transcribeVoiceMessage(message.id, mediaInfo.relativePath, io, roomId).catch((err: unknown) => {
        logger.error(`[lineMessageBridge] Background transcription error: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (e) {
      logger.warn(`[lineMessageBridge] transcribeVoiceMessage not available: ${e instanceof Error ? e.message : String(e)}`);
    }

    logger.info(`[lineMessageBridge] voice post: room=${roomId} msg=${message.id} file=${mediaInfo.fileName}`);
    return { message, media: mediaResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * file message を Tealus に post (= Phase 2.1、bot.js /push-file 同型)
 *
 * 一般 file (= 画像/動画/PDF 等の任意添付) を file type で投影。thumbnail なし、width/height なし、
 * transcribe trigger なし。LINE webhook の type=file event 用。
 *
 * @param params.roomId
 * @param params.sender
 * @param params.mediaInfo - lineBridge.saveLineContentToFile の return value
 * @param params.content
 * @param params.replyTo
 * @param params.io
 */
export async function postFileToTealus(
  { roomId, sender, mediaInfo, content, replyTo, io }: PostMediaParams
): Promise<{ message: MessageRow; media: MediaRow }> {
  if (!roomId) throw new Error('roomId is required');
  if (!sender) throw new Error('sender is required');
  if (!mediaInfo) throw new Error('mediaInfo is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, 'file', $4) RETURNING *`,
      [roomId, sender.id, content || null, replyTo || null]
    );
    const message = msgResult.rows[0];

    const mediaResult = await client.query<MediaRow>(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [message.id, mediaInfo.relativePath, mediaInfo.fileName, mediaInfo.mimeType, mediaInfo.fileSize]
    );
    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', {
        ...message,
        sender_display_name: sender.display_name,
        sender_avatar_url: sender.avatar_url,
        media: [mediaResult.rows[0]],
      });
    }

    logger.info(`[lineMessageBridge] file post: room=${roomId} msg=${message.id} file=${mediaInfo.fileName}`);
    return { message, media: mediaResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * video message を Tealus に post (= Phase 2.1、bot.js /push-image video 同型 + ffmpeg thumbnail)
 *
 * video type で投影。thumbnail は generateThumbnail (= ffmpeg 既存) で 1sec frame extract。
 * width/height は null 固定 (= video metadata 取得は Phase 3 課題、ffprobe dependency 必要)。
 * transcribe trigger なし (= voice 専用)。
 *
 * @param params.roomId
 * @param params.sender
 * @param params.mediaInfo - lineBridge.saveLineContentToFile の return value
 * @param params.content
 * @param params.replyTo
 * @param params.io
 */
export async function postVideoToTealus(
  { roomId, sender, mediaInfo, content, replyTo, io }: PostMediaParams
): Promise<{ message: MessageRow; media: MediaRow }> {
  if (!roomId) throw new Error('roomId is required');
  if (!sender) throw new Error('sender is required');
  if (!mediaInfo) throw new Error('mediaInfo is required');

  // thumbnail 生成 (= 既存 generateThumbnail、失敗時は null fallback)
  let thumbnailPath: string | null = null;
  try {
    thumbnailPath = await generateThumbnail(mediaInfo.filePath, mediaInfo.mimeType);
  } catch (e) {
    logger.warn(`[lineMessageBridge] generateThumbnail failed for video: ${e instanceof Error ? e.message : String(e)}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, 'video', $4) RETURNING *`,
      [roomId, sender.id, content || null, replyTo || null]
    );
    const message = msgResult.rows[0];

    const mediaResult = await client.query<MediaRow>(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, thumbnail_path)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [message.id, mediaInfo.relativePath, mediaInfo.fileName, mediaInfo.mimeType, mediaInfo.fileSize, thumbnailPath]
    );
    await client.query('COMMIT');

    if (io) {
      io.to(roomId).emit('message:new', {
        ...message,
        sender_display_name: sender.display_name,
        sender_avatar_url: sender.avatar_url,
        media: [mediaResult.rows[0]],
      });
    }

    logger.info(`[lineMessageBridge] video post: room=${roomId} msg=${message.id} file=${mediaInfo.fileName} thumb=${thumbnailPath || 'null'}`);
    return { message, media: mediaResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** LINE webhook の location event fields */
export interface LineLocation {
  /** 場所名、user 任意 */
  title?: string | null;
  /** 住所、user 任意 */
  address?: string | null;
  /** 緯度 */
  latitude?: number | null;
  /** 経度 */
  longitude?: number | null;
}

/**
 * location message を Tealus に post (= Phase 2.2)
 *
 * LINE webhook の location event を ★ text type + markdown で Tealus 投影。
 * 内部で postTextToTealus を呼び出し、★ Tealus 既存 MessageBubble の markdown rendering で
 * 「📍 + 緯度経度 + Google Maps link」 が自動表示される (= messages schema 変更なし)。
 *
 * @param params.roomId
 * @param params.sender
 * @param params.location - LINE webhook の location event fields
 *   - title: string|null (= 場所名、user 任意)
 *   - address: string|null (= 住所、user 任意)
 *   - latitude: number (= 緯度)
 *   - longitude: number (= 経度)
 * @param params.senderLabel - 送信者ラベル「氏名@グループ名」(= #309 案A、先頭行に太字で付与)
 * @param params.replyTo
 * @param params.io
 */
export async function postLocationToTealus(
  { roomId, sender, location, senderLabel, replyTo, io }: {
    roomId: string;
    sender: LineSenderContext;
    location: LineLocation;
    senderLabel?: string | null;
    replyTo?: string | null;
    io?: Server | null;
  }
): Promise<{ message: MessageRow }> {
  if (!roomId) throw new Error('roomId is required');
  if (!sender) throw new Error('sender is required');
  if (!location) throw new Error('location is required');

  const { title, address, latitude, longitude } = location;

  // 全 field null (= 緯度経度すらない) は throw、★ 緯度経度のみあれば OK
  const hasCoords = latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined;
  const hasLabel = title || address;
  if (!hasCoords && !hasLabel) {
    throw new Error('location must have at least latitude/longitude or title/address');
  }

  const label = title || address || '位置情報';
  const coordsLine = hasCoords ? `緯度: ${latitude}, 経度: ${longitude}` : '';
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${latitude},${longitude}` : null;

  // markdown format (= Tealus MessageBubble で remarkGfm + remarkBreaks 自動 rendering)
  // #309 案A: senderLabel があれば先頭行に「[氏名@グループ名]」を付与
  const lines: string[] = [];
  if (senderLabel) lines.push(`[${senderLabel}]`);
  lines.push(`📍 ${label}`);
  if (address && address !== label) lines.push(address);
  if (coordsLine) lines.push(coordsLine);
  if (mapsUrl) lines.push('', `[地図を開く](${mapsUrl})`);
  const content = lines.join('\n');

  return postTextToTealus({ roomId, sender, content, replyTo, io });
}
