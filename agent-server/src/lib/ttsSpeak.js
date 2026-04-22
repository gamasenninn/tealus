/**
 * TTS 読み上げモジュール (#154)
 *
 * Aivis Cloud API で音声合成し、PlainTransport でトランシーバーに送信する。
 * agent-server から直接呼べるライブラリ。
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const logger = require("./logger");

const AIVIS_API_KEY = process.env.AIVIS_API_KEY;
const MODEL_UUID = process.env.AIVIS_MODEL_UUID || "f5017410-fbb5-49e1-97cb-e785f42e15f5";
const RTC_PORT = process.env.RTC_PORT || 3100;
const TTS_ENABLED = process.env.TTS_ENABLED !== "false"; // デフォルト ON
const MAX_LENGTH = parseInt(process.env.TTS_MAX_LENGTH || "500", 10);
const SSRC = 1111;

/**
 * テキスト前処理（Markdown除去、URL省略、長文切り詰め）
 */
function preprocessText(content) {
  if (!content) return null;

  let text = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "URL省略")
    .replace(/```[\s\S]*?```/g, "コード省略")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (text.length > MAX_LENGTH) {
    text = text.substring(0, MAX_LENGTH) + "。以下省略。";
  }

  return text || null;
}

/**
 * Aivis Cloud API で音声合成
 */
function synthesize(text, modelUuid) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model_uuid: modelUuid || MODEL_UUID,
      text,
      output_format: "wav",
    });
    const req = https.request("https://api.aivis-project.com/v1/tts/synthesize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AIVIS_API_KEY}`,
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 200) resolve(buf);
        else reject(new Error(`TTS error ${res.statusCode}: ${buf.toString().substring(0, 200)}`));
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("TTS request timeout")); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/**
 * PlainTransport で RTP 送信
 */
function sendViaPlainTransport(wavPath, roomId) {
  return new Promise((resolve, reject) => {
    const peerId = "tts-" + Math.random().toString(36).slice(2, 8);
    const pendingResolvers = [];
    let ws;

    function send(msg) { ws.send(JSON.stringify(msg)); }
    function waitFor(pred) {
      return new Promise((res) => pendingResolvers.push({ predicate: pred, resolve: res }));
    }

    ws = new WebSocket(`ws://localhost:${RTC_PORT}/ws`);

    ws.on("open", async () => {
      try {
        send({ type: "join", peerId, roomId });
        await waitFor((m) => m.type === "joined");

        send({ type: "createPlainTransport" });
        const pt = await waitFor((m) => m.type === "plainTransportCreated");

        send({ type: "plainProduce", transportId: pt.id, ssrc: SSRC });
        await waitFor((m) => m.type === "produced");

        const ffmpeg = spawn("ffmpeg", [
          "-re", "-i", wavPath,
          "-c:a", "libopus", "-ac", "2", "-ar", "48000", "-b:a", "32k",
          "-f", "rtp", "-ssrc", String(SSRC), "-payload_type", "100",
          `rtp://127.0.0.1:${pt.port}`,
        ], { stdio: ["ignore", "pipe", "pipe"] });

        ffmpeg.on("close", (code) => {
          send({ type: "leave" });
          ws.close();
          resolve(code);
        });

        ffmpeg.on("error", (err) => {
          send({ type: "leave" });
          ws.close();
          reject(err);
        });
      } catch (err) {
        ws.close();
        reject(err);
      }
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      for (let i = pendingResolvers.length - 1; i >= 0; i--) {
        if (pendingResolvers[i].predicate(msg)) {
          const { resolve } = pendingResolvers.splice(i, 1)[0];
          resolve(msg);
          return;
        }
      }
    });

    ws.on("error", reject);
  });
}

// --- キュー管理（同時読み上げ防止）---
const queue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { roomId, text } = queue.shift();
    try {
      const startTime = Date.now();
      const wavBuf = await synthesize(text);
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
 */
function speakMessage(roomId, content) {
  if (!TTS_ENABLED || !AIVIS_API_KEY) return;

  // エラーメッセージはスキップ
  if (/^[❌⚠️]/.test(content)) return;

  const text = preprocessText(content);
  if (!text) return;

  queue.push({ roomId, text });
  processQueue();
}

module.exports = { speakMessage };
