#!/usr/bin/env node
/**
 * PlainTransport + RTP 送信テスト (#153)
 *
 * 使い方:
 *   node test-plain-rtp.js [roomId] [audioFile]
 *
 * 例:
 *   node test-plain-rtp.js test-room test_audio.ogg
 *   node test-plain-rtp.js  ← デフォルト: room=plain-test, 無音テスト
 *
 * 前提:
 *   - rtc-server が起動している (localhost:3100)
 *   - ffmpeg がインストールされている
 */

const WebSocket = require("ws");
const { spawn } = require("child_process");

const RTC_HOST = process.env.RTC_HOST || "localhost";
const RTC_PORT = process.env.RTC_PORT || 3100;
const ROOM_ID = process.argv[2] || "plain-test";
const AUDIO_FILE = process.argv[3] || null;
const SSRC = 1111;
const PEER_ID = "plain-rtp-" + Math.random().toString(36).slice(2, 8);

let ws;
const pendingResolvers = [];

function send(msg) {
  console.log(`  -> ${msg.type}`);
  ws.send(JSON.stringify(msg));
}

function waitFor(predicate) {
  return new Promise((resolve) => {
    pendingResolvers.push({ predicate, resolve });
  });
}

function onMessage(data) {
  const msg = JSON.parse(data);
  console.log(`  <- ${msg.type}`);

  for (let i = pendingResolvers.length - 1; i >= 0; i--) {
    if (pendingResolvers[i].predicate(msg)) {
      const { resolve } = pendingResolvers.splice(i, 1)[0];
      resolve(msg);
      return;
    }
  }
}

async function main() {
  console.log(`=== PlainTransport RTP Test ===`);
  console.log(`Room: ${ROOM_ID}`);
  console.log(`Peer: ${PEER_ID}`);
  console.log(`Audio: ${AUDIO_FILE || "(silence test)"}`);
  console.log();

  // 1. WebSocket 接続
  const wsUrl = `ws://${RTC_HOST}:${RTC_PORT}/ws`;
  console.log(`[1] Connecting to ${wsUrl}...`);
  ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
  ws.on("message", onMessage);
  console.log("  Connected!\n");

  // 2. Join room
  console.log(`[2] Joining room: ${ROOM_ID}...`);
  send({ type: "join", peerId: PEER_ID, roomId: ROOM_ID });
  const joinResp = await waitFor((m) => m.type === "joined");
  console.log(`  Joined! (router codecs available)\n`);

  // 3. Create PlainTransport
  console.log(`[3] Creating PlainTransport...`);
  send({ type: "createPlainTransport" });
  const ptResp = await waitFor((m) => m.type === "plainTransportCreated");
  console.log(`  PlainTransport created!`);
  const rtpIp = "127.0.0.1"; // ローカルテストでは常に localhost に送る
  console.log(`  Transport ID: ${ptResp.id}`);
  console.log(`  RTP endpoint:  ${rtpIp}:${ptResp.port} (announced: ${ptResp.ip})`);
  console.log();

  // 4. Produce (audio/opus)
  console.log(`[4] Creating Producer (audio/opus, ssrc=${SSRC})...`);
  send({ type: "plainProduce", transportId: ptResp.id, ssrc: SSRC });
  const prodResp = await waitFor((m) => m.type === "produced");
  console.log(`  Producer created: ${prodResp.producerId}\n`);

  // 5. Send RTP via ffmpeg
  if (AUDIO_FILE) {
    console.log(`[5] Sending RTP via ffmpeg...`);
    console.log(`  ffmpeg -re -i ${AUDIO_FILE} -> rtp://${rtpIp}:${ptResp.port}`);
    console.log();

    // ffmpeg で Opus RTP ストリームを送信
    // -re: リアルタイム速度で読み出し
    // -c:a libopus: Opus エンコード
    // -ssrc: mediasoup の Producer と一致させる
    // -payload_type 100: Producer の payloadType と一致
    const ffmpeg = spawn("ffmpeg", [
      "-re",
      "-i", AUDIO_FILE,
      "-c:a", "libopus",
      "-ac", "2",
      "-ar", "48000",
      "-b:a", "32k",
      "-f", "rtp",
      "-ssrc", String(SSRC),
      "-payload_type", "100",
      `rtp://${rtpIp}:${ptResp.port}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    ffmpeg.stdout.on("data", (d) => process.stdout.write(d));
    ffmpeg.stderr.on("data", (d) => {
      const line = d.toString();
      // ffmpeg のプログレス行だけ表示
      if (line.includes("size=") || line.includes("time=")) {
        process.stdout.write(`  ${line}`);
      }
    });

    ffmpeg.on("close", (code) => {
      console.log(`\n  ffmpeg exited with code ${code}`);
      console.log("\n=== Test Complete ===");
      console.log("Check the browser transceiver to see if audio was received.");
      cleanup();
    });

    // Ctrl+C で中断
    process.on("SIGINT", () => {
      console.log("\n  Stopping...");
      ffmpeg.kill("SIGTERM");
      cleanup();
    });
  } else {
    // 音声ファイルなし — 接続確認のみ
    console.log(`[5] No audio file specified. PlainTransport is ready.`);
    console.log(`  To send audio manually:`);
    console.log(`  ffmpeg -re -i your_audio.ogg -c:a libopus -ac 2 -ar 48000 -f rtp -ssrc ${SSRC} -payload_type 100 rtp://${rtpIp}:${ptResp.port}`);
    console.log();
    console.log("  Press Ctrl+C to exit.");

    process.on("SIGINT", () => {
      cleanup();
    });
  }
}

function cleanup() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: "leave" });
    ws.close();
  }
  setTimeout(() => process.exit(0), 500);
}

main().catch((err) => {
  console.error("Error:", err.message);
  cleanup();
});
