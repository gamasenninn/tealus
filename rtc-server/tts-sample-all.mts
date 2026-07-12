#!/usr/bin/env node
/**
 * 全モデルのTTSサンプルを生成し、業務メモに音声メッセージとして送信
 */
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.join(import.meta.dirname, "../server/.env") });

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import FormData from 'form-data';

const AIVIS_API_KEY = process.env.AIVIS_API_KEY;
const TEALUS_API = "http://localhost:3000";
const ROOM_ID = process.argv[2] || "5a33a62c-8bf0-41cf-a748-c76a38ef1c7f";
const SAMPLE_TEXT = "こんにちは。私はAivis Speechの音声合成モデルです。Tealusのトランシーバーに音声を送信するテストをしています。この声はいかがでしょうか？";

// --- Tealus API helpers ---
async function tealusLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ login_id: "BOT001", password: "1234" });
    const req = http.request(`${TEALUS_API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve((JSON.parse(body) as { token: string }).token));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function sendVoiceMessage(token: string, filePath: string, text?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("voice", fs.createReadStream(filePath));

    const req = http.request(`${TEALUS_API}/api/rooms/${ROOM_ID}/voice`, {
      method: "POST",
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Voice upload failed: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on("error", reject);
    form.pipe(req);
  });
}

async function sendTextMessage(token: string, content: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ content });
    const req = http.request(`${TEALUS_API}/api/rooms/${ROOM_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// --- Aivis TTS ---
async function synthesize(modelUuid: string, text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model_uuid: modelUuid,
      text,
      output_format: "mp3",
    });
    const req = https.request("https://api.aivis-project.com/v1/tts/synthesize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AIVIS_API_KEY}`,
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 200) {
          resolve(buf);
        } else {
          reject(new Error(`TTS failed: ${res.statusCode} ${buf.toString().substring(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

interface AivisModel {
  aivm_model_uuid: string;
  name: string;
  voice_timbre: string;
  total_download_count: number;
  [key: string]: unknown;
}

// --- Aivis model search ---
async function searchModels(): Promise<AivisModel[]> {
  return new Promise((resolve, reject) => {
    https.get("https://api.aivis-project.com/v1/aivm-models/search?limit=30&sort=download", {
      headers: { Authorization: `Bearer ${AIVIS_API_KEY}` },
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve((JSON.parse(body) as { aivm_models: AivisModel[] }).aivm_models));
    }).on("error", reject);
  });
}

const TIMBRE_LABELS: Record<string, string> = {
  YoungMale: "少年", YoungFemale: "少女",
  YouthfulMale: "青年男性", YouthfulFemale: "青年女性",
  AdultMale: "成人男性", AdultFemale: "成人女性",
  MiddleAgedMale: "中年男性", MiddleAgedFemale: "中年女性",
  ElderlyMale: "老年男性", ElderlyFemale: "老年女性",
  Neutral: "ニュートラル", Baby: "赤ちゃん", Mechanical: "機械", Other: "その他",
};

async function main(): Promise<void> {
  console.log("=== TTS Sample Generator ===\n");

  // Login
  const token = await tealusLogin();
  console.log("Tealus login OK\n");

  // Get models
  const models = await searchModels();
  console.log(`Found ${models.length} models\n`);

  const outDir = path.join(import.meta.dirname, "tts_samples");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const label = TIMBRE_LABELS[m.voice_timbre] || m.voice_timbre;
    const displayName = `${m.name}（${label}）`;

    console.log(`[${i + 1}/${models.length}] ${displayName}...`);

    try {
      // 1. TTS 合成
      const audioBuf = await synthesize(m.aivm_model_uuid, SAMPLE_TEXT);
      const filePath = path.join(outDir, `${m.name.replace(/[\/\\?*:|"<>]/g, "_")}.mp3`);
      fs.writeFileSync(filePath, audioBuf);
      console.log(`  TTS OK (${(audioBuf.length / 1024).toFixed(0)} KB)`);

      // 2. テキストメッセージ（モデル情報）
      await sendTextMessage(token, `🔊 音声サンプル: ${displayName}\nモデルID: ${m.aivm_model_uuid}\nDL数: ${m.total_download_count}`);

      // 3. 音声メッセージ送信
      await sendVoiceMessage(token, filePath);
      console.log(`  Sent to business memo ✅`);

      // API レート制限回避（少し待つ）
      await new Promise<void>((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
