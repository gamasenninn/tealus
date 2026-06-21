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
const express = require('express');
const path = require('path');
const pool = require('../db/pool');
const { verifyLineSignature } = require('../services/lineSignature');
const { fetchLineContent, fetchLineStickerImage, saveLineContentToFile } = require('../services/lineBridge');
const {
  postTextToTealus,
  postImageToTealus,
  postVoiceToTealus,
  postFileToTealus,
  postVideoToTealus,
  postLocationToTealus,
} = require('../services/lineMessageBridge');
const { loadGroupToRoomMap } = require('../services/lineGroupMappings');
const { upsertGroupEntry, readGroupName } = require('../services/lineGroupCatalog');
const { getMemberDisplayName } = require('../services/lineMemberCatalog');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 送信者ラベル「氏名@グループ名」を解決する (= #309 案A MVP)
 *
 * - cfg.senderLabel が明示指定されていればそれを使う (= test override、null も可)
 * - source.userId + channelToken が揃えば member profile (cache) で氏名を取得
 * - 氏名取得不可 (userId 無 / token 無 / API fail) は null → caller 側でラベルなし degrade
 * - group 名は catalog (= line-groups.json) から読む。未収集なら「氏名」のみ
 *
 * @returns {Promise<string|null>} 「氏名@グループ名」 or 「氏名」 or null
 */
async function resolveSenderLabel(event, groupId, channelToken, cfg = {}) {
  if (Object.prototype.hasOwnProperty.call(cfg, 'senderLabel')) return cfg.senderLabel;

  const userId = event.source && event.source.userId;
  if (!userId || !channelToken) return null;

  let name = null;
  try {
    name = await getMemberDisplayName(groupId, userId, channelToken, { fetchImpl: cfg.memberFetchImpl });
  } catch (e) {
    logger.warn(`[LINE Bridge] sender name resolve failed: ${e.message}`);
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
function applyContentLabel(label, body) {
  if (!label) return body;
  const head = `[${label}]`;
  return (body && body.length > 0) ? `${head}\n${body}` : head;
}

const SECRET_PATH = process.env.LINE_WEBHOOK_SECRET_PATH;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BOT_USER_ID = process.env.LINE_BOT_USER_ID;
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, '../../../media');

/**
 * 単一 event を Tealus に post (= test-friendly な独立 function)
 *
 * @param {Object} event - LINE webhook event
 * @param {Object} [options]
 * @param {Object} [options.io] - Socket.IO instance
 * @param {Object} [options.config] - 設定上書き (= test 用)
 *   - groupToRoomMap, botUserId, channelToken, mediaRoot
 * @returns {Promise<{ skipped?: string, posted?: string }>}
 */
async function dispatchEvent(event, options = {}) {
  const cfg = options.config || {};
  // ★ Phase 2.3: cfg.groupToRoomMap (= test 用 override) があればそれ、なければ file/env から webhook 毎 load
  // (= file 編集後 restart 不要、次 webhook で即反映)
  const map = cfg.groupToRoomMap || loadGroupToRoomMap();
  const botUserId = cfg.botUserId || BOT_USER_ID;
  const channelToken = cfg.channelToken || CHANNEL_TOKEN;
  const mediaRoot = cfg.mediaRoot || MEDIA_ROOT;
  const io = options.io;

  // entry log: silent skip ('not-group' 等) でも「届いた事実」を log で binary 残す
  // (= memory feedback_silent_skip_log_distinction.md、AI session が「届かない」誤判断するのを構造的に防止する device、恒久)
  logger.info(`[LINE Bridge] dispatchEvent: type=${event?.type}, source=${event?.source?.type}, msg=${event?.message?.type}`);

  if (!event || event.type !== 'message') return { skipped: 'not-message' };
  if (!event.source || event.source.type !== 'group') return { skipped: 'not-group' };

  const groupId = event.source.groupId;

  // ★ Phase 2.3: catalog update (= group name 自動収集、unmapped/mapped 関係なく upsert)
  // user は server/config/line-groups.json で group name ↔ ID 対応を確認、★ ★ ID コピペで line-group-mappings.json 編集
  // catalog 失敗は silent (= dispatchEvent を阻害しない、200 OK 最優先)
  if (!cfg.skipCatalog) {
    const snippet = event.message?.text || (event.message?.type ? `[${event.message.type}]` : null);
    upsertGroupEntry(groupId, {
      sender: event.source.userId || null,
      snippet,
      timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : undefined,
    }, { accessToken: channelToken }).catch((e) => {
      logger.warn(`[LINE Bridge] catalog upsert failed: ${e.message}`);
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
  let sender;
  if (cfg.sender) {
    sender = cfg.sender;
  } else {
    try {
      const userRes = await pool.query(
        `SELECT id, display_name, avatar_url FROM users WHERE id = $1`,
        [botUserId]
      );
      if (userRes.rows.length === 0) {
        logger.warn(`[LINE Bridge] bot user not found: ${botUserId}`);
        return { skipped: 'bot-user-not-found' };
      }
      sender = userRes.rows[0];
    } catch (err) {
      logger.error(`[LINE Bridge] bot user fetch failed: ${err.message}`);
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
    const signature = req.headers['x-line-signature'] || '';
    if (!verifyLineSignature(CHANNEL_SECRET, req.body, signature)) {
      logger.warn('[LINE Bridge] signature verify failed');
      return res.status(200).json({ ok: true });
    }

    // (3) parse body
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (e) {
      logger.warn(`[LINE Bridge] JSON parse failed: ${e.message}`);
      return res.status(200).json({ ok: true }); // 200 で retry 防止
    }

    // (4) 200 OK 即返却 (= LINE 公式 timeout 回避、内部処理は async 続行)
    res.status(200).json({ ok: true });

    // (5) Background event dispatch
    if (!Array.isArray(payload.events) || payload.events.length === 0) return;

    // io instance を lazy import (= app.js circular avoid)
    let io;
    try {
      io = require('../app').io;
    } catch (e) {
      // ignore
    }

    for (const event of payload.events) {
      try {
        await dispatchEvent(event, { io });
      } catch (err) {
        logger.error(`[LINE Bridge] event dispatch error: ${err.message}`);
      }
    }
  }
);

// Export dispatchEvent for unit testing
router.dispatchEvent = dispatchEvent;
router.loadGroupToRoomMap = loadGroupToRoomMap; // ★ re-export from lineGroupMappings for backward compat

module.exports = router;
