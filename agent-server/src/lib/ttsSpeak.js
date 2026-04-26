/**
 * TTS 読み上げモジュール (#154)
 *
 * Aivis Cloud API で音声合成し、PlainTransport でトランシーバーに送信する。
 * agent-server から直接呼べるライブラリ。
 * 合成・送信の実装は tts-core.js に集約（rtc-server の CLI と共有）。
 */
const fs = require("fs");
const path = require("path");
const ttsCore = require("./tts-core");
const logger = require("./logger");

const AIVIS_API_KEY = process.env.AIVIS_API_KEY;
const MODEL_UUID = process.env.AIVIS_MODEL_UUID || "f5017410-fbb5-49e1-97cb-e785f42e15f5";
const RTC_PORT = process.env.RTC_PORT || 3100;
const TTS_ENABLED = process.env.TTS_ENABLED !== "false"; // デフォルト ON
const MAX_LENGTH = parseInt(process.env.TTS_MAX_LENGTH || "500", 10);
const SSRC = 1111;

/**
 * テキスト前処理（Markdown除去、URL変換、長文切り詰め）
 *
 * 変換ルール:
 *  - コードブロック → 「コード省略」
 *  - 見出し（#） → 除去
 *  - 太字・斜体（* や _） → 文字のみ残す
 *  - 画像 ![alt](url) → 「画像」
 *  - リンク [text](url) → text のみ（タイトルを読む）
 *  - 裸の URL → 「こちらのリンク」
 *  - インラインコード → 文字のみ残す
 *  - 引用 > → 除去
 *  - リスト記号 - / * / 数字. → 除去
 *  - 連続改行 → 1 つに
 */
function preprocessText(content) {
  if (!content) return null;

  let text = content
    // コードブロックは最初に処理（内部にリンク等が含まれうるため）
    .replace(/```[\s\S]*?```/g, "コード省略")
    // 見出し
    .replace(/^#{1,6}\s+/gm, "")
    // 太字・斜体（1〜3重）
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // 画像 ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "画像")
    // リンク [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // 裸のURL → 「こちらのリンク」
    .replace(/https?:\/\/\S+/g, "こちらのリンク")
    // インラインコード
    .replace(/`([^`]+)`/g, "$1")
    // 引用記号 >
    .replace(/^>\s?/gm, "")
    // リスト記号
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // 水平線
    .replace(/^-{3,}$/gm, "")
    // 連続改行
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (text.length > MAX_LENGTH) {
    text = text.substring(0, MAX_LENGTH) + "。以下省略。";
  }

  return text || null;
}

/**
 * Aivis Cloud API で音声合成（tts-core の薄いラッパー）
 * 既存呼び出し元 (routes/tts.js) との互換性のため (text, modelUuid) を受ける。
 */
function synthesize(text, modelUuid) {
  return ttsCore.synthesize(text, {
    modelUuid: modelUuid || MODEL_UUID,
    apiKey: AIVIS_API_KEY,
  });
}

/**
 * PlainTransport で RTP 送信（tts-core の薄いラッパー）
 */
function sendViaPlainTransport(wavPath, roomId) {
  return ttsCore.sendViaPlainTransport(wavPath, roomId, {
    rtcPort: RTC_PORT,
    ssrc: SSRC,
  });
}

// --- ルーム設定から TTS モデルを取得 ---
function getRoomTtsModel(roomId) {
  try {
    const agentId = require('./botApi').getBotUserId();
    if (!agentId) return null;
    const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT || path.join(__dirname, '../../agent-workspaces');
    const settingsPath = path.join(workspaceRoot, agentId, roomId, 'room_settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return settings.tts_model_uuid || null;
  } catch { return null; }
}

// TTS_BROADCAST_MEDIASOUP=true なら Aivis 合成 WAV を mediasoup PlainTransport
// でも broadcast (transceiver gateway 受信機向けの legacy 互換)。default false。
const BROADCAST_MEDIASOUP = process.env.TTS_BROADCAST_MEDIASOUP === 'true';

// --- キュー管理（同時読み上げ防止）---
const queue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { roomId, text, modelUuid } = queue.shift();
    const botApi = require('./botApi');

    let wavBuf;
    try {
      const startTime = Date.now();
      wavBuf = await synthesize(text, modelUuid);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`[TTS] 合成OK (${(wavBuf.length / 1024).toFixed(0)}KB, ${elapsed}s) → room ${roomId}`);
    } catch (err) {
      // Aivis 合成失敗 → browser TTS に fallback
      const msg = (err && (err.message || err.code)) || 'unknown';
      logger.error(`[TTS] 合成エラー: ${msg}, falling back to browser TTS`);
      try {
        await botApi.pushTtsSpeak(roomId, text);
      } catch (e2) {
        logger.warn(`[TTS] browser fallback also failed: ${e2.message}`);
      }
      continue;
    }

    // Primary: Socket.IO blob 配信 (rtc 非依存、新設計の主経路)
    try {
      await botApi.pushTtsAudio(roomId, wavBuf);
      logger.info(`[TTS] Socket.IO 配信完了 → room ${roomId}`);
    } catch (err) {
      // Socket.IO 配信失敗 → browser TTS に fallback
      const msg = (err && err.message) || 'unknown';
      logger.error(`[TTS] Socket.IO 配信失敗: ${msg}, falling back to browser TTS`);
      try {
        await botApi.pushTtsSpeak(roomId, text);
      } catch (e2) {
        logger.warn(`[TTS] browser fallback also failed: ${e2.message}`);
      }
      // mediasoup 並走も意味がないので skip
      continue;
    }

    // Optional: mediasoup broadcast (TTS_BROADCAST_MEDIASOUP=true、transceiver gateway 受信機向け)
    if (BROADCAST_MEDIASOUP) {
      const tmpFile = path.join(__dirname, `../../.tts-tmp-${Date.now()}.wav`);
      try {
        fs.writeFileSync(tmpFile, wavBuf);
        await sendViaPlainTransport(tmpFile, roomId);
        logger.info(`[TTS] mediasoup 配信完了 → room ${roomId}`);
      } catch (err) {
        // mediasoup 失敗は warning のみ — 主経路 (Socket.IO) は成功している
        logger.warn(`[TTS] mediasoup 配信失敗 (Socket.IO は成功): ${err.message}`);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    }
  }

  isProcessing = false;
}

/**
 * メッセージを読み上げる（fire-and-forget）
 * pushMessage の後に呼ぶ。メッセージ送信をブロックしない。
 *
 * TTS_PROVIDER (config) で動作を分岐:
 *   - 'browser'     : Socket.IO 'tts:speak' で text を配信、各 client が Web Speech API で発声
 *   - 'aivis-cloud' : agent-server で WAV 合成 → server に POST → Socket.IO 'tts:audio' で URL 配信
 *                     → 各 client が <audio> で再生 (rtc-server 不要、#189)
 *                     TTS_BROADCAST_MEDIASOUP=true なら並行で mediasoup 配信も (legacy)
 *   - 'none'        : 何もしない
 *
 * Aivis 合成 / Socket.IO 配信が失敗した場合は browser TTS (text 経由) に fallback。
 */
function speakMessage(roomId, content) {
  if (!TTS_ENABLED) return;

  // エラーメッセージはスキップ
  if (/^[❌⚠️]/.test(content)) return;

  const text = preprocessText(content);
  if (!text) return;

  const config = require('../config');
  const provider = config.TTS_PROVIDER;

  if (provider === 'none') return;

  if (provider === 'browser') {
    // Server に通知 → server が Socket.IO で room に emit → 各 client が Web Speech で発声
    const botApi = require('./botApi');
    botApi.pushTtsSpeak(roomId, text).catch((err) => {
      logger.warn(`[TTS] browser provider notify failed: ${err.message}`);
    });
    return;
  }

  // provider === 'aivis-cloud'
  if (!AIVIS_API_KEY) {
    logger.warn('[TTS] aivis-cloud selected but AIVIS_API_KEY not set, falling back to browser');
    const botApi = require('./botApi');
    botApi.pushTtsSpeak(roomId, text).catch(() => {});
    return;
  }
  const modelUuid = getRoomTtsModel(roomId) || MODEL_UUID;
  logger.info(`[TTS] model: ${modelUuid} (room: ${roomId}, default: ${MODEL_UUID})`);
  queue.push({ roomId, text, modelUuid });
  processQueue();
}

module.exports = { speakMessage, synthesize, preprocessText };
