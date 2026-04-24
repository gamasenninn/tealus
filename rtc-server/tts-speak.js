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
 *
 * 合成・送信のロジックは agent-server/src/lib/tts-core.js に集約。
 * 本スクリプトは CLI 引数処理と stdout 進捗表示のラッパー。
 */
require("dotenv").config({ path: require("path").join(__dirname, "../server/.env") });

const fs = require("fs");
const path = require("path");
const ttsCore = require("../agent-server/src/lib/tts-core");

const AIVIS_API_KEY = process.env.AIVIS_API_KEY;
const DEFAULT_MODEL = process.env.AIVIS_MODEL_UUID || "f5017410-fbb5-49e1-97cb-e785f42e15f5";
const RTC_PORT = parseInt(process.env.RTC_PORT || "3100", 10);
const SSRC = 1111;

// CLI 引数（モジュール利用時は無視）
const ROOM_ID = require.main === module ? process.argv[2] : null;
const TEXT = require.main === module ? (process.argv[3] || null) : null;
const MODEL_UUID = require.main === module ? (process.argv[4] || DEFAULT_MODEL) : DEFAULT_MODEL;

// --- 公開 API: tts-core の薄いラッパー（互換性維持） ---
function synthesize(text, modelUuid) {
  return ttsCore.synthesize(text, {
    modelUuid: modelUuid || DEFAULT_MODEL,
    apiKey: AIVIS_API_KEY,
  });
}

function sendViaPlainTransport(wavPath, roomId) {
  return ttsCore.sendViaPlainTransport(wavPath, roomId, {
    rtcPort: RTC_PORT,
    ssrc: SSRC,
    onProgress: (time) => process.stdout.write(`\r  🔊 ${time}`),
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

  // 2. PlainTransport で送信（onProgress で stdout に time= 表示）
  process.stdout.write("  [2/2] トランシーバー送信中...\n");
  try {
    await sendViaPlainTransport(tmpFile, ROOM_ID);
    process.stdout.write("\n");
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
