import { getIo } from '../io-registry.mts';
/**
 * LINE Bridge webhook endpoint (Phase 1、Inbound 受信のみ)
 *
 * POST /api/line/webhook/:secret
 *   - secret path verify (= 隠し URL)
 *   - X-Line-Signature HMAC-SHA256 verify
 *   - events[] iterate + dispatch (= text / image / audio)
 *   - LINE group → Tealus room mapping (= env LINE_GROUP_TO_ROOM、未登録 silent skip)
 *   - sender = LINE bot user (= env LINE_BOT_USER_ID)
 *   - ★ ★ ★ LINE 公式 spec 準拠: secret path/signature verify 失敗でも 200 silent return + log warn のみ
 *     (= 6/4 Day 19 fix、non-2xx で webhook auto-suspend 防止 + security 観点で URL/sig 情報 leak 防止)
 *   - ★ 200 OK 即返却 + background event dispatch (= LINE 公式 timeout 回避)
 *
 * @module routes/line
 */
import express from 'express';
import path from 'node:path';
import type { Server } from 'socket.io';
import { pool } from '../db/pool.mts';
import { verifyLineSignature } from '../services/lineSignature.mts';
import { fetchLineContent, fetchLineStickerImage, saveLineContentToFile } from '../services/lineBridge.mts';
import type { FetchLike } from '../services/lineBridge.mts';
import {
  postTextToTealus,
  postImageToTealus,
  postImagesToTealus,
  postVoiceToTealus,
  postFileToTealus,
  postVideoToTealus,
  postLocationToTealus,
} from '../services/lineMessageBridge.mts';
import type { LineSenderContext } from '../services/lineMessageBridge.mts';
import { ImageSetBuffer, DEFAULT_FLUSH_DELAY_MS } from '../services/lineImageSetBuffer.mts';
import { loadGroupToRoomMap } from '../services/lineGroupMappings.mts';
import { upsertGroupEntry, readGroupName } from '../services/lineGroupCatalog.mts';
import { getMemberDisplayName } from '../services/lineMemberCatalog.mts';
import { logger } from '../utils/logger.mts';

export const router = express.Router();

/** LINE webhook event の source (= group message 時は groupId あり) */
interface LineEventSource {
  type?: string;
  groupId?: string;
  userId?: string | null;
}

/** LINE webhook event の message */
interface LineEventMessage {
  id: string;
  type?: string;
  text?: string;
  fileName?: string;
  stickerId?: string | number;
  title?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** ★ #353: 複数画像同時送信時のみ付与 (LINE 11.15 以前の Android は付かない) */
  imageSet?: { id: string; index: number; total: number };
}

/** LINE webhook event */
interface LineWebhookEvent {
  type?: string;
  timestamp?: number;
  source?: LineEventSource;
  message?: LineEventMessage;
}

/** dispatchEvent の設定上書き (= test 用) */
interface DispatchConfig {
  groupToRoomMap?: Record<string, string>;
  botUserId?: string;
  channelToken?: string;
  mediaRoot?: string;
  skipCatalog?: boolean;
  sender?: LineSenderContext;
  senderLabel?: string | null;
  memberFetchImpl?: FetchLike;
}

/** dispatchEvent の options */
interface DispatchOptions {
  io?: Server | null;
  config?: DispatchConfig;
}

/** dispatchEvent の結果 (= skipped / posted のどちらか一方) */
interface DispatchResult {
  skipped?: string;
  posted?: string;
}

/**
 * 送信者ラベル「氏名@グループ名」を解決する (= #309 案A MVP)
 *
 * - cfg.senderLabel が明示指定されていればそれを使う (= test override、null も可)
 * - source.userId + channelToken が揃えば member profile (cache) で氏名を取得
 * - 氏名取得不可 (userId 無 / token 無 / API fail) は null → caller 側でラベルなし degrade
 * - group 名は catalog (= line-groups.json) から読む。未収集なら「氏名」のみ
 *
 * @returns 「氏名@グループ名」 or 「氏名」 or null
 */
async function resolveSenderLabel(
  event: LineWebhookEvent,
  groupId: string,
  channelToken: string | undefined,
  cfg: DispatchConfig = {}
): Promise<string | null> {
  if (Object.prototype.hasOwnProperty.call(cfg, 'senderLabel')) return cfg.senderLabel as string | null;

  const userId = event.source && event.source.userId;
  if (!userId || !channelToken) return null;

  let name: string | null = null;
  try {
    name = await getMemberDisplayName(groupId, userId, channelToken, { fetchImpl: cfg.memberFetchImpl });
  } catch (e) {
    logger.warn(`[LINE Bridge] sender name resolve failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!name) return null;

  const groupName = readGroupName(groupId);
  return groupName ? `${name}@${groupName}` : name;
}

/**
 * content 先頭に「**ラベル**」を付与する (= #309 案A)。
 * - label が null/空 → body をそのまま返す (= 従来挙動、body は undefined もあり得る)
 * - body あり → 「**label**\n本文」、body 無し (= media caption) → 「**label**」
 */
function applyContentLabel(label: string | null | undefined, body: string): string;
function applyContentLabel(label: string | null | undefined, body: string | undefined): string | undefined;
function applyContentLabel(label: string | null | undefined, body: string | undefined): string | undefined {
  if (!label) return body;
  const head = `[${label}]`;
  return (body && body.length > 0) ? `${head}\n${body}` : head;
}

const SECRET_PATH = process.env.LINE_WEBHOOK_SECRET_PATH;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BOT_USER_ID = process.env.LINE_BOT_USER_ID;
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(import.meta.dirname, '../../../media');

// ★ #353: imageSet 再構成バッファ (= プロセスに 1 個)。LINE の複数画像同時送信は
// 画像ごと別 webhook + 順不同で届くため、imageSet.id 単位で貯めて 1 メッセージに束ねる。
// total 未達でも LINE_IMAGESET_FLUSH_MS (既定 15s) で部分 flush = 欠落しても止まらない。
const imageSetBuffer = new ImageSetBuffer({
  flushDelayMs: Number(process.env.LINE_IMAGESET_FLUSH_MS) || DEFAULT_FLUSH_DELAY_MS,
  onFlush: async (ctx, images) => {
    await postImagesToTealus({
      roomId: ctx.roomId,
      sender: ctx.sender,
      mediaInfos: images.map((i) => i.mediaInfo),
      content: ctx.content,
      io: ctx.io,
    });
  },
});

/**
 * 単一 event を Tealus に post (= test-friendly な独立 function)
 *
 * @param event - LINE webhook event
 * @param options
 *   - options.io - Socket.IO instance
 *   - options.config - 設定上書き (= test 用)
 *     - groupToRoomMap, botUserId, channelToken, mediaRoot
 */
export async function dispatchEvent(
  event: LineWebhookEvent | null | undefined,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const cfg = options.config || {};
  // ★ Phase 2.3: cfg.groupToRoomMap (= test 用 override) があればそれ、なければ file/env から webhook 毎 load
  // (= file 編集後 restart 不要、次 webhook で即反映)
  const map = cfg.groupToRoomMap || loadGroupToRoomMap();
  const botUserId = cfg.botUserId || BOT_USER_ID;
  // env 未設定時は undefined のまま下流へ流し、fetchLineContent 側の runtime check に委ねる (= JS 版と同挙動)
  const channelToken = (cfg.channelToken || CHANNEL_TOKEN) as string;
  const mediaRoot = cfg.mediaRoot || MEDIA_ROOT;
  const io = options.io;

  // entry log: silent skip ('not-group' 等) でも「届いた事実」を log で binary 残す
  // (= memory feedback_silent_skip_log_distinction.md、AI session が「届かない」誤判断するのを構造的に防止する device、恒久)
  logger.info(`[LINE Bridge] dispatchEvent: type=${event?.type}, source=${event?.source?.type}, msg=${event?.message?.type}`);

  // ★ #367: join (= bot がグループに招待された) は catalog upsert だけ通し、★ ★ 投影経路には入れない。
  // join は本文を持たないので Tealus に投稿するものが無い。目的は group ID / name を
  // 「1 通投稿してください」と頼む前に確定させ、mapping (= line-group-mappings.json) を先に書き終えられるようにすること
  // (= 2026-08-03「営業報告」追加時、join の 5 分後まで mapping が無く 3 件を unmapped-group で捨てた)。
  // memberJoined (= 他ユーザーの参加) は既に catalog にある group で起きるので対象外。
  if (event?.type === 'join' && event.source?.type === 'group' && event.source.groupId) {
    const joinGroupId = event.source.groupId;
    if (!cfg.skipCatalog) {
      // ★ message 経路と違い後続処理が無いので await できる (= webhook 応答は router 側で既に 200 済み)。
      // await して「catalog に入った / 名前が取れた」を log に binary で残す
      // (= memory feedback_silent_skip_log_distinction.md、入口 log だけでは upsert の成否が判別できない)
      await upsertGroupEntry(joinGroupId, {
        timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : undefined,
      }, { accessToken: channelToken }).catch((e) => {
        // catalog 失敗は silent (= message 経路と同じ、200 OK 最優先)。name は次の message で再 try される
        logger.warn(`[LINE Bridge] catalog upsert failed (join): ${e instanceof Error ? e.message : String(e)}`);
      });
      logger.info(`[LINE Bridge] join catalogued: ${joinGroupId} name=${readGroupName(joinGroupId) || '(未取得)'}`);
    }
    return { skipped: 'join-catalogued' };
  }

  if (!event || event.type !== 'message') return { skipped: 'not-message' };
  if (!event.source || event.source.type !== 'group') return { skipped: 'not-group' };

  // LINE spec 上 group source は groupId を必ず持つ (= 欠落時は下流の runtime check で JS 版同様に skip / warn)
  const groupId = event.source.groupId as string;

  // ★ Phase 2.3: catalog update (= group name 自動収集、unmapped/mapped 関係なく upsert)
  // user は server/config/line-groups.json で group name ↔ ID 対応を確認、★ ★ ID コピペで line-group-mappings.json 編集
  // catalog 失敗は silent (= dispatchEvent を阻害しない、200 OK 最優先)
  if (!cfg.skipCatalog) {
    const snippet = event.message?.text || (event.message?.type ? `[${event.message.type}]` : undefined);
    upsertGroupEntry(groupId, {
      sender: event.source.userId || undefined,
      snippet,
      timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : undefined,
    }, { accessToken: channelToken }).catch((e) => {
      logger.warn(`[LINE Bridge] catalog upsert failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  const roomId = map[groupId];
  if (!roomId) {
    logger.debug(`[LINE Bridge] unmapped group: ${groupId}`);
    return { skipped: 'unmapped-group' };
  }

  if (!botUserId) {
    logger.warn(`[LINE Bridge] LINE_BOT_USER_ID not set`);
    return { skipped: 'no-bot-user' };
  }

  const message = event.message;
  if (!message) return { skipped: 'no-message' };

  // ★ Option D (= Day 21 PM): bot user info を context object として取得 + 6 helper に sender 渡し
  // (= socket.user / req.user pattern 1:1 整合、helper 内 DB query ゼロ + module state ゼロ)
  // ★ ★ test override: cfg.sender で test 用に直接 sender object 渡せる
  let sender: LineSenderContext;
  if (cfg.sender) {
    sender = cfg.sender;
  } else {
    try {
      const userRes = await pool.query<LineSenderContext>(
        `SELECT id, display_name, avatar_url FROM users WHERE id = $1`,
        [botUserId]
      );
      if (userRes.rows.length === 0) {
        logger.warn(`[LINE Bridge] bot user not found: ${botUserId}`);
        return { skipped: 'bot-user-not-found' };
      }
      sender = userRes.rows[0];
    } catch (err) {
      logger.error(`[LINE Bridge] bot user fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return { skipped: 'bot-user-fetch-error' };
    }
  }

  // ★ #309 案A: LINE 送信者名 + group 名を「**氏名@グループ名**」として content 先頭に添える (MVP)
  // 取得不可 (userId 無 / token 無 / API fail) は null → ラベルなしで従来どおり「LINE Bridge」表示に degrade
  const senderLabel = await resolveSenderLabel(event, groupId, channelToken, cfg);

  switch (message.type) {
    case 'text':
      await postTextToTealus({
        roomId,
        sender,
        content: applyContentLabel(senderLabel, message.text || ''),
        io,
      });
      return { posted: 'text' };

    case 'image': {
      const { buffer, mimeType } = await fetchLineContent(message.id, channelToken);
      const mediaInfo = await saveLineContentToFile(buffer, mimeType, mediaRoot, { subdir: 'line-images' });

      // ★ #353: 複数画像同時送信 (imageSet) はバッファに積み、そろってから 1 メッセージに束ねる。
      // imageSet 無し (単発 / LINE 11.15 以前の Android) は従来どおり個別 post に degrade。
      const imageSet = message.imageSet;
      if (imageSet && imageSet.id && imageSet.total > 1) {
        const flushed = imageSetBuffer.add(
          imageSet.id,
          imageSet.total,
          { index: imageSet.index, mediaInfo },
          { roomId, sender, content: applyContentLabel(senderLabel, undefined), io }
        );
        return { posted: flushed ? 'image-set' : 'image-set-buffered' };
      }

      await postImageToTealus({
        roomId,
        sender,
        mediaInfo,
        content: applyContentLabel(senderLabel, undefined),
        io,
      });
      return { posted: 'image' };
    }

    case 'audio': {
      const { buffer, mimeType } = await fetchLineContent(message.id, channelToken);
      const mediaInfo = await saveLineContentToFile(buffer, mimeType, mediaRoot, { subdir: 'line-voices' });
      await postVoiceToTealus({
        roomId,
        sender,
        mediaInfo,
        content: applyContentLabel(senderLabel, undefined),
        io,
      });
      return { posted: 'voice' };
    }

    case 'file': {
      const { buffer, mimeType } = await fetchLineContent(message.id, channelToken);
      // ★ LINE webhook の file event は message.fileName を含む (= LINE Messaging API spec)
      // 元ファイル名で投影することで「.bin になってしまう」問題回避 (= 6/5 Day 20 user dogfood で判明)
      const mediaInfo = await saveLineContentToFile(buffer, mimeType, mediaRoot, {
        subdir: 'line-files',
        originalFileName: message.fileName,
      });
      await postFileToTealus({
        roomId,
        sender,
        mediaInfo,
        content: applyContentLabel(senderLabel, undefined),
        io,
      });
      return { posted: 'file' };
    }

    case 'video': {
      const { buffer, mimeType } = await fetchLineContent(message.id, channelToken);
      const mediaInfo = await saveLineContentToFile(buffer, mimeType, mediaRoot, { subdir: 'line-videos' });
      await postVideoToTealus({
        roomId,
        sender,
        mediaInfo,
        content: applyContentLabel(senderLabel, undefined),
        io,
      });
      return { posted: 'video' };
    }

    case 'sticker': {
      // ★ Phase 2.2: sticker は LINE 公式 sticker shop CDN から直接 PNG fetch
      // (= LINE Content API は sticker 非対応 = 400、★ 6/5 Day 20 dogfood で判明)
      // Tealus 既存 image type 流用で投影 (= migration 不要、image grid で自然表示)
      const { buffer, mimeType } = await fetchLineStickerImage(message.stickerId);
      const mediaInfo = await saveLineContentToFile(buffer, mimeType, mediaRoot, { subdir: 'line-stickers' });
      await postImageToTealus({
        roomId,
        sender,
        mediaInfo,
        content: applyContentLabel(senderLabel, undefined),
        io,
      });
      return { posted: 'sticker' };
    }

    case 'location': {
      // ★ Phase 2.2: location は text + markdown で投影 (= 既存 MessageBubble の markdown rendering で
      // 自動的に 「📍 + 緯度経度 + Google Maps link」 表示、messages schema 拡張なし)
      const { title, address, latitude, longitude } = message;
      await postLocationToTealus({
        roomId,
        sender,
        location: { title, address, latitude, longitude },
        senderLabel,
        io,
      });
      return { posted: 'location' };
    }

    default:
      logger.debug(`[LINE Bridge] unsupported message type: ${message.type}`);
      return { skipped: `unsupported-type-${message.type}` };
  }
}

/**
 * POST /api/line/webhook/:secret
 *
 * raw body 受信 (= signature verify 必要、JSON.parse は verify 後)
 */
router.post(
  '/webhook/:secret',
  async (req, res) => {
    // (1) secret path check
    // LINE 公式 spec: webhook は常に 2xx 必須 (= non-2xx で webhook auto-suspend、6/4 Day 19 真犯人特定)
    // secret path mismatch でも 200 silent return + log warn のみ (= memory feedback_line_webhook_200_required.md)
    // security side benefit: 攻撃者に「URL exists」情報を leak しない
    if (!SECRET_PATH || req.params.secret !== SECRET_PATH) {
      logger.warn(`[LINE Bridge] secret path mismatch`);
      return res.status(200).json({ ok: true });
    }

    // (2) signature verify
    // LINE 公式 spec: webhook は常に 2xx 必須、signature verify failed でも 200 silent return + log warn のみ
    // security side benefit: 攻撃者に「signature verify status」情報を leak しない
    const signature = (req.headers['x-line-signature'] as string | undefined) || '';
    if (!verifyLineSignature(CHANNEL_SECRET, req.body, signature)) {
      logger.warn('[LINE Bridge] signature verify failed');
      return res.status(200).json({ ok: true });
    }

    // (3) parse body
    let payload: { events?: LineWebhookEvent[] };
    try {
      payload = JSON.parse(req.body.toString('utf8')) as { events?: LineWebhookEvent[] };
    } catch (e) {
      logger.warn(`[LINE Bridge] JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
      return res.status(200).json({ ok: true }); // 200 で retry 防止
    }

    // (4) 200 OK 即返却 (= LINE 公式 timeout 回避、内部処理は async 続行)
    res.status(200).json({ ok: true });

    // (5) Background event dispatch
    if (!Array.isArray(payload.events) || payload.events.length === 0) return;

    // io instance を lazy import (= app circular avoid、ESM でも dynamic import で遅延を保持)
    let io: Server | undefined;
    try {
      io = getIo();
    } catch {
      // ignore
    }

    for (const event of payload.events) {
      try {
        await dispatchEvent(event, { io });
      } catch (err) {
        logger.error(`[LINE Bridge] event dispatch error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
);

// Export dispatchEvent for unit testing (= named export、router へのプロパティ添付は #330 TS 化で廃止)
export { loadGroupToRoomMap }; // ★ re-export from lineGroupMappings for backward compat
