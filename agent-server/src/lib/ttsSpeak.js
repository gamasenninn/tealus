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

// --- キュー管理（同時読み上げ防止）---
const queue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { roomId, text, modelUuid } = queue.shift();
    try {
      const startTime = Date.now();
      const wavBuf = await synthesize(text, modelUuid);
      const tmpFile = path.join(__dirname, `../../.tts-tmp-${Date.now()}.wav`);
      fs.writeFileSync(tmpFile, wavBuf);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`[TTS] 合成OK (${(wavBuf.length / 1024).toFixed(0)}KB, ${elapsed}s) → room ${roomId}`);

      try {
        await sendViaPlainTransport(tmpFile, roomId);
        logger.info(`[TTS] 送信完了 → room ${roomId}`);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } catch (err) {
      logger.error(`[TTS] エラー: ${err.message}`);
    }
  }

  isProcessing = false;
}

/**
 * メッセージを読み上げる（fire-and-forget）
 * pushMessage の後に呼ぶ。メッセージ送信をブロックしない。
 *
 * TTS_PROVIDER (config) で動作を分岐:
 *   - 'browser'     : Socket.IO 経由で client に text を流し、各端末の Web Speech API で発声
 *   - 'aivis-cloud' : 既存の Aivis Cloud + mediasoup PlainTransport で配信
 *   - 'none'        : 何もしない
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
    logger.warn('[TTS] aivis-cloud selected but AIVIS_API_KEY not set, skipping');
    return;
  }
  const modelUuid = getRoomTtsModel(roomId) || MODEL_UUID;
  logger.info(`[TTS] model: ${modelUuid} (room: ${roomId}, default: ${MODEL_UUID})`);
  queue.push({ roomId, text, modelUuid });
  processQueue();
}

module.exports = { speakMessage, synthesize, preprocessText };
