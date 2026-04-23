#!/usr/bin/env node
/**
 * Claude Code Notification Hook → TTS 読み上げ
 * stdin から JSON を受け取り、通知メッセージを TTS でトランシーバーに送信
 */
const { spawn } = require("child_process");
const path = require("path");

const ROOM_ID = "5a33a62c-8bf0-41cf-a748-c76a38ef1c7f";
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, "../..");
const TTS_SPEAK = path.join(PROJECT_DIR, "rtc-server", "tts-speak.js");

// stdin から通知メッセージを抽出
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let message = "通知があります";
  try {
    const data = JSON.parse(input);
    message = data.message || message;
  } catch {}

  // TTS で読み上げ（detached — Claude の処理をブロックしない）
  const child = spawn("node", [TTS_SPEAK, ROOM_ID, message], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
});
