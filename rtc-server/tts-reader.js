#!/usr/bin/env node
/**
 * TTS 読み上げ監視デーモン (#154)
 *
 * Socket.IO クライアントとしてメッセージを監視し、
 * AI エージェントのメッセージを TTS → PlainTransport でトランシーバーに読み上げる。
 *
 * 使い方:
 *   node tts-reader.js
 *   pm2 start tts-reader.js --name tts-reader
 *
 * 環境変数(.env):
 *   AIVIS_API_KEY          — Aivis Cloud API キー（必須）
 *   AIVIS_MODEL_UUID       — デフォルトモデル（省略時: 凛音エル）
 *   TTS_READER_ROOMS       — "all" または "roomId1,roomId2"（省略時: all）
 *   TTS_READER_WATCH       — "bot" / "all" / "mention"（省略時: bot）
 *   TTS_READER_MAX_LENGTH  — 読み上げ最大文字数（省略時: 500）
 */
require("dotenv").config({ path: require("path").join(__dirname, "../server/.env") });

const http = require("http");
const fs = require("fs");
const path = require("path");
const { io } = require("socket.io-client");
const { synthesize, sendViaPlainTransport } = require("./tts-speak");

// --- 設定 ---
const TEALUS_API = process.env.TEALUS_API_URL || "http://localhost:3000";
// reader は監視専用アカウントで接続（AI_AGENT のメッセージを読み上げるため別アカウント）
const BOT_EMPLOYEE_ID = process.env.TTS_READER_BOT_ID || "BOT001";
const BOT_PASSWORD = process.env.TTS_READER_BOT_PASS || "1234";
const WATCH_ROOMS = process.env.TTS_READER_ROOMS || "all";
const WATCH_MODE = process.env.TTS_READER_WATCH || "bot";
const MAX_LENGTH = parseInt(process.env.TTS_READER_MAX_LENGTH || "500", 10);
const MODEL_UUID = process.env.AIVIS_MODEL_UUID || "f5017410-fbb5-49e1-97cb-e785f42e15f5";

let myUserId = null;
let token = null;
let targetRoomIds = null; // null = all

// --- Tealus API ---
function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login() {
  const body = JSON.stringify({ employee_id: BOT_EMPLOYEE_ID, password: BOT_PASSWORD });
  const res = await httpRequest(`${TEALUS_API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  }, body);
  if (res.status !== 200 || !res.data.token) {
    throw new Error(`Login failed: ${JSON.stringify(res.data)}`);
  }
  token = res.data.token;
  myUserId = res.data.user.id;
  console.log(`  ログイン OK (user: ${res.data.user.display_name}, id: ${myUserId})`);
}

async function getRooms() {
  const res = await httpRequest(`${TEALUS_API}/api/rooms`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.rooms || [];
}

// --- テキスト前処理 ---
function preprocessText(content) {
  if (!content) return null;

  let text = content
    // Markdown 見出し
    .replace(/^#{1,6}\s+/gm, "")
    // Markdown 太字・斜体
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    // Markdown リンク
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // URL を省略
    .replace(/https?:\/\/\S+/g, "URL省略")
    // コードブロック
    .replace(/```[\s\S]*?```/g, "コード省略")
    // インラインコード
    .replace(/`([^`]+)`/g, "$1")
    // 連続改行を1つに
    .replace(/\n{2,}/g, "\n")
    .trim();

  // 長文切り詰め
  if (text.length > MAX_LENGTH) {
    text = text.substring(0, MAX_LENGTH) + "。以下省略。";
  }

  return text || null;
}

// --- 読み上げキュー ---
const queue = [];
let isProcessing = false;

function enqueue(roomId, text, senderName) {
  queue.push({ roomId, text, senderName });
  processQueue();
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { roomId, text, senderName } = queue.shift();
    try {
      console.log(`\n🔊 読み上げ: [${senderName}] ${text.substring(0, 50)}...`);

      // TTS 合成
      const startTime = Date.now();
      const wavBuf = await synthesize(text, MODEL_UUID);
      const tmpFile = path.join(__dirname, `.tts-reader-tmp-${Date.now()}.wav`);
      fs.writeFileSync(tmpFile, wavBuf);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  TTS OK (${(wavBuf.length / 1024).toFixed(0)} KB, ${elapsed}s)`);

      // PlainTransport で送信
      try {
        await sendViaPlainTransport(tmpFile, roomId);
        console.log("  ✅ 送信完了");
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } catch (err) {
      console.error(`  ❌ エラー: ${err.message}`);
    }
  }

  isProcessing = false;
}

// --- メッセージフィルタ ---
function shouldRead(msg) {
  // text 以外はスキップ
  if (msg.type !== "text") return false;

  // 自分自身のメッセージはスキップ（無限ループ防止）
  if (msg.sender_id === myUserId) return false;

  // 対象ルーム判定
  if (targetRoomIds && !targetRoomIds.has(msg.room_id)) return false;

  // 監視モード判定
  switch (WATCH_MODE) {
    case "all":
      return true;
    case "bot":
      // sender_id が自分（Bot）以外の Bot かどうか
      // Bot の判定: display_name に AI/bot/Agent/アシスタント/Claude を含む
      const name = msg.sender_display_name || "";
      return /AI|bot|Bot|Agent|アシスタント|Claude/i.test(name);
    case "mention":
      // メンションされている場合のみ
      return (msg.content || "").includes("@");
    default:
      return false;
  }
}

// --- メイン ---
async function main() {
  console.log("=== TTS Reader デーモン ===");
  console.log(`  監視モード: ${WATCH_MODE}`);
  console.log(`  対象ルーム: ${WATCH_ROOMS}`);
  console.log(`  最大文字数: ${MAX_LENGTH}`);
  console.log(`  モデル: ${MODEL_UUID}`);
  console.log();

  // 1. ログイン
  await login();

  // 2. ルーム取得
  const rooms = await getRooms();
  console.log(`  参加ルーム: ${rooms.length}件`);

  // 対象ルーム設定
  if (WATCH_ROOMS !== "all") {
    targetRoomIds = new Set(WATCH_ROOMS.split(",").map((s) => s.trim()));
    console.log(`  監視対象: ${targetRoomIds.size}件`);
  }

  // 3. Socket.IO 接続
  console.log("\n  Socket.IO 接続中...");
  const socket = io(TEALUS_API, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", () => {
    console.log(`  ✅ Socket.IO 接続 (id: ${socket.id})`);

    // ルーム参加
    for (const room of rooms) {
      if (targetRoomIds && !targetRoomIds.has(room.id)) continue;
      socket.emit("room:join", room.id);
    }
    console.log(`  ルーム参加完了\n`);
    console.log("  📻 メッセージ監視中... (Ctrl+C で停止)\n");
  });

  socket.on("disconnect", (reason) => {
    console.log(`  ⚠️ Socket.IO 切断: ${reason}`);
  });

  socket.on("reconnect", (attempt) => {
    console.log(`  🔄 再接続成功 (${attempt}回目)`);
    // 再接続時にルーム再参加
    for (const room of rooms) {
      if (targetRoomIds && !targetRoomIds.has(room.id)) continue;
      socket.emit("room:join", room.id);
    }
  });

  // 4. メッセージ監視
  socket.on("message:new", (msg) => {
    const senderName = msg.sender_display_name || "不明";
    console.log(`  📨 [${senderName}] (${msg.type}) ${(msg.content || "").substring(0, 40)}`);

    if (!shouldRead(msg)) {
      return;
    }

    const text = preprocessText(msg.content);
    if (!text) return;

    enqueue(msg.room_id, text, senderName);
  });

  // 5. Graceful shutdown
  const shutdown = () => {
    console.log("\n  シャットダウン中...");
    socket.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
