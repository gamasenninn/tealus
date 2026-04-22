#!/usr/bin/env node
/**
 * TTS 読み上げ → トランシーバー送信 統合コマンド
 *
 * 使い方:
 *   node tts-speak.js <roomId> "読み上げるテキスト"
 *   node tts-speak.js <roomId> "テキスト" [modelUuid]
 *   echo "テキスト" | node tts-speak.js <roomId>
 *
 * 例:
 *   node tts-speak.js 5a33a62c-... "こんにちは、テストです"
 *   node tts-speak.js 5a33a62c-... "別の声で" 71e72188-2726-4739-9aa9-39567396fb2a
 *
 * 環境変数(.env):
 *   AIVIS_API_KEY     — Aivis Cloud API キー（必須）
 *   AIVIS_MODEL_UUID  — デフォルトモデル（省略時: 凛音エル）
 */
require("dotenv").config({ path: require("path").join(__dirname, "../server/.env") });

const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const AIVIS_API_KEY = process.env.AIVIS_API_KEY;
const DEFAULT_MODEL = process.env.AIVIS_MODEL_UUID || "f5017410-fbb5-49e1-97cb-e785f42e15f5";
const RTC_PORT = process.env.RTC_PORT || 3100;
const SSRC = 1111;

// CLI 引数（モジュール利用時は無視）
const ROOM_ID = require.main === module ? process.argv[2] : null;
const TEXT = require.main === module ? (process.argv[3] || null) : null;
const MODEL_UUID = require.main === module ? (process.argv[4] || DEFAULT_MODEL) : DEFAULT_MODEL;

// --- Aivis TTS ---
function synthesize(text, modelUuid) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model_uuid: modelUuid,
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
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 200) resolve(buf);
        else reject(new Error(`TTS error ${res.statusCode}: ${buf.toString().substring(0, 200)}`));
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// --- PlainTransport RTP 送信 ---
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
        // Join
        send({ type: "join", peerId, roomId });
        await waitFor((m) => m.type === "joined");

        // PlainTransport
        send({ type: "createPlainTransport" });
        const pt = await waitFor((m) => m.type === "plainTransportCreated");

        // Produce
        send({ type: "plainProduce", transportId: pt.id, ssrc: SSRC });
        await waitFor((m) => m.type === "produced");

        // ブラウザ側の Consumer セットアップを待つ
        await new Promise((r) => setTimeout(r, 2000));

        // ffmpeg で RTP 送信
        const ffmpeg = spawn("ffmpeg", [
          "-re", "-i", wavPath,
          "-af", "adelay=300|300,apad=pad_dur=500ms",
          "-c:a", "libopus", "-ac", "2", "-ar", "48000", "-b:a", "32k",
          "-f", "rtp", "-ssrc", String(SSRC), "-payload_type", "100",
          `rtp://127.0.0.1:${pt.port}`,
        ], { stdio: ["ignore", "pipe", "pipe"] });

        ffmpeg.stderr.on("data", (d) => {
          const line = d.toString();
          if (line.includes("time=")) {
            const match = line.match(/time=(\S+)/);
            if (match) process.stdout.write(`\r  🔊 ${match[1]}`);
          }
        });

        ffmpeg.on("close", (code) => {
          process.stdout.write("\n");
          // 最後の RTP パケットが mediasoup で処理されるのを待つ
          setTimeout(() => {
            send({ type: "leave" });
            ws.close();
            resolve(code);
          }, 1500);
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

// --- stdin からテキスト読み取り ---
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

// --- Main (CLI only) ---
async function main() {
  if (!ROOM_ID) {
    console.error("Usage: node tts-speak.js <roomId> \"テキスト\" [modelUuid]");
    console.error("       echo \"テキスト\" | node tts-speak.js <roomId>");
    process.exit(1);
  }
  if (!AIVIS_API_KEY) {
    console.error("Error: AIVIS_API_KEY is not set in .env");
    process.exit(1);
  }

  // テキスト取得（引数 or stdin）
  let text = TEXT || (await readStdin());
  if (!text) {
    console.error("Error: テキストが指定されていません");
    process.exit(1);
  }

  // 3000文字制限
  if (text.length > 3000) {
    console.warn(`Warning: テキストが${text.length}文字あります。3000文字に切り詰めます。`);
    text = text.substring(0, 3000);
  }

  console.log(`📝 テキスト: ${text.substring(0, 60)}${text.length > 60 ? "..." : ""}`);
  console.log(`🎤 モデル: ${MODEL_UUID}`);
  console.log(`📻 ルーム: ${ROOM_ID}`);
  console.log();

  // 1. TTS 合成
  process.stdout.write("  [1/2] 音声合成中...");
  const startTime = Date.now();
  const wavBuf = await synthesize(text, MODEL_UUID);
  const tmpFile = path.join(__dirname, `.tts-tmp-${Date.now()}.wav`);
  fs.writeFileSync(tmpFile, wavBuf);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(` OK (${(wavBuf.length / 1024).toFixed(0)} KB, ${elapsed}s)`);

  // 2. PlainTransport で送信
  process.stdout.write("  [2/2] トランシーバー送信中...\n");
  try {
    await sendViaPlainTransport(tmpFile, ROOM_ID);
    console.log("  ✅ 完了");
  } finally {
    // 一時ファイル削除
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// --- モジュール export ---
module.exports = { synthesize, sendViaPlainTransport };

// CLI 実行時のみ main() を呼ぶ
if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
