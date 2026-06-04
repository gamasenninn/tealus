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
const { verifyLineSignature } = require('../services/lineSignature');
const { fetchLineContent, saveLineContentToFile } = require('../services/lineBridge');
const {
  postTextToTealus,
  postImageToTealus,
  postVoiceToTealus,
} = require('../services/lineMessageBridge');
const logger = require('../utils/logger');

const router = express.Router();

// Environment at startup
function loadGroupToRoomMap() {
  try {
    return JSON.parse(process.env.LINE_GROUP_TO_ROOM || '{}');
  } catch (e) {
    logger.warn(`[LINE Bridge] LINE_GROUP_TO_ROOM JSON parse failed: ${e.message}`);
    return {};
  }
}

const groupToRoomMap = loadGroupToRoomMap();
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
  const map = cfg.groupToRoomMap || groupToRoomMap;
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

  switch (message.type) {
    case 'text':
      await postTextToTealus({
        roomId,
        senderUserId: botUserId,
        content: message.text || '',
        io,
      });
      return { posted: 'text' };

    case 'image': {
      const { buffer, mimeType } = await fetchLineContent(message.id, channelToken);
      const mediaInfo = await saveLineContentToFile(buffer, mimeType, mediaRoot, { subdir: 'line-images' });
      await postImageToTealus({
        roomId,
        senderUserId: botUserId,
        mediaInfo,
        io,
      });
      return { posted: 'image' };
    }

    case 'audio': {
      const { buffer, mimeType } = await fetchLineContent(message.id, channelToken);
      const mediaInfo = await saveLineContentToFile(buffer, mimeType, mediaRoot, { subdir: 'line-voices' });
      await postVoiceToTealus({
        roomId,
        senderUserId: botUserId,
        mediaInfo,
        io,
      });
      return { posted: 'voice' };
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
router.loadGroupToRoomMap = loadGroupToRoomMap;

module.exports = router;
