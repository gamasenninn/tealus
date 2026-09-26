/**
 * TTS 読み上げモジュール (#154)
 *
 * Aivis Cloud API で音声合成し、PlainTransport でトランシーバーに送信する。
 * agent-server から直接呼べるライブラリ。
 * 合成・送信の実装は tts-core.js に集約（rtc-server の CLI と共有）。
 */
import fs from 'node:fs';
import path from 'node:path';
import * as ttsCore from './tts-core.mts';
import { synthesizeOpenai } from './tts-openai.mts';
import { synthesizeGemini } from './tts-gemini.mts';
import { resolveRoomTts, readRoomTtsSettings } from './ttsRoom.mts';
import { applyReadingHints } from './tts-reading.mts';
import { logger } from './logger.mts';
import * as config from '../config.mts';
import { pushTtsSpeak, pushTtsAudio } from './botApi.mts';

const AIVIS_API_KEY = process.env.AIVIS_API_KEY;
const MODEL_UUID = process.env.AIVIS_MODEL_UUID || "f5017410-fbb5-49e1-97cb-e785f42e15f5";
const RTC_PORT = process.env.RTC_PORT || 3100;
const TTS_ENABLED = process.env.TTS_ENABLED !== "false"; // デフォルト ON
const MAX_LENGTH = parseInt(process.env.TTS_MAX_LENGTH || "500", 10);
// Aivis Cloud TTS API の文字数上限 (超過すると 422 string_too_long で合成失敗)。
// truncate 設定に関わらず常に enforce する hard cap。
const HARD_LIMIT = parseInt(process.env.TTS_HARD_LIMIT || "3000", 10);
const SSRC = 1111;
// ★ #444: OpenAI TTS の既定。★★ voice は会話モード (Realtime) の既定と同じ marin に揃える。
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'marin';
// ★ 2026-09-26: Gemini TTS の既定は tts-gemini.mts (Lite / Kore / 業務連絡の話し方)。★★ env は差し替えたいときだけ
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || undefined;
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || undefined;
/** ★ 空文字を「話し方の指定なし」として通すため、未設定だけ undefined にする */
const GEMINI_TTS_STYLE = process.env.GEMINI_TTS_STYLE;

import type { TtsEngine } from './ttsRoom.mts';
export type { TtsEngine };

/**
 * ★ TTS_PROVIDER → 合成 engine の対応 (2026-09-26)。★★ 手動ボタン (routes/tts.mts) はここを使う。
 *   以前はルートの中に三項演算子で書いてあり、テストが無かった。
 */
export function engineForProvider(provider: string | undefined): TtsEngine {
  if (provider === 'openai') return 'openai';
  if (provider === 'gemini') return 'gemini';
  return 'aivis';
}

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
export function preprocessText(content: string | null | undefined, opts: { truncate?: boolean } = {}): string | null {
  // #292 follow-up (6/13 14:56 業務メモ user voice 「バブルボタンによる読上は全文読上でもいい」):
  // truncate=true (= default、auto-read / 自動読み上げ用): 500 文字超は「以下省略。」付加
  // truncate=false (= 個人 button 経由 routes/tts.js): 全文をそのまま synthesize
  const { truncate = true } = opts;
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
    // ★ 強調の ★ / ☆ (2026-09-26 利用者: 「★★… があるとそれを変に読んでしまう」)。後ろの空白ごと取る
    .replace(/[★☆]+[ \t　]*/g, "")
    // 連続改行
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (truncate && text.length > MAX_LENGTH) {
    text = text.substring(0, MAX_LENGTH) + "。以下省略。";
  }

  // Aivis TTS API の硬い上限 (3000 文字) は truncate 設定に関わらず常に enforce。
  // これを超えると 422 string_too_long で全失敗するため (= 終礼など長文議事録の
  // ボタン読み上げ failure の根治、#286/#292 follow-up)。少し余裕を見て cap。
  if (text.length > HARD_LIMIT) {
    text = text.substring(0, HARD_LIMIT - 20) + "。以下省略。";
  }

  return text || null;
}

/**
 * Aivis Cloud API で音声合成（tts-core の薄いラッパー）
 * 既存呼び出し元 (routes/tts.js) との互換性のため (text, modelUuid) を受ける。
 */
export function synthesize(text: string, modelUuid?: string): Promise<Buffer> {
  return ttsCore.synthesize(text, {
    modelUuid: modelUuid || MODEL_UUID,
    apiKey: AIVIS_API_KEY,
  });
}

/**
 * ★★★★★ 合成の分岐は **ここ 1 か所**だけ (#444 段 2)
 *
 * ★ 自動読み上げ (processQueue) と 手動ボタン (routes/tts.mts) の両方がここを通る。
 *   ★★ 記憶「同じ仕事が 2 か所にあると壊れを隠す」—— ★★★ 分岐を 2 度書かない。
 *
 * ★ 読みを当てるかどうか (#446) も ここで決まる:
 *   ★★ openai だけに当てる。★★★ aivis は正しく読めているので触らない。
 *
 * ★ 失敗は throw する。★★ fallback するかどうかは **呼び出し側**が決める
 *   (自動読み上げは browser TTS へ / 手動ボタンは 500 を返す)。
 */
export async function synthesizeByEngine(
  engine: TtsEngine,
  text: string,
  modelUuid?: string,
  /** ★ 2026-09-26: ルームで選んだ声 (openai / gemini)。無ければ .env の声 */
  voice?: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (engine === 'gemini') {
    // ★ 2026-09-26: Gemini も読み違える (7俵 → ななたま)。★★ openai と同じく TTS に渡す文だけ書き換える
    const hinted = applyReadingHints(text);
    if (hinted.applied.length) {
      logger.info(`[TTS/読み] ${hinted.applied.map((a) => `${a.term}→${a.reading}×${a.count}`).join(' ')}`);
    }
    return synthesizeGemini(hinted.text, {
      apiKey: config.GOOGLE_API_KEY,
      model: GEMINI_TTS_MODEL,
      voice: voice || GEMINI_TTS_VOICE,
      style: GEMINI_TTS_STYLE,
    });
  }
  if (engine === 'openai') {
    // ★ #446: OpenAI は固有名詞を読み違える (鹿沼 → シカヌマ)。
    //   ★★ TTS に渡す文だけ書き換える。保存される本文は 1 文字も変わらない。
    const hinted = applyReadingHints(text);
    if (hinted.applied.length) {
      // ★ 黙って書き換えない
      logger.info(`[TTS/読み] ${hinted.applied.map((a) => `${a.term}→${a.reading}×${a.count}`).join(' ')}`);
    }
    return synthesizeOpenai(hinted.text, {
      apiKey: config.OPENAI_API_KEY,
      model: OPENAI_TTS_MODEL,
      voice: voice || OPENAI_TTS_VOICE,
    });
  }
  return { buffer: await synthesize(text, modelUuid), contentType: 'audio/wav' };
}

/**
 * PlainTransport で RTP 送信（tts-core の薄いラッパー）
 */
function sendViaPlainTransport(wavPath: string, roomId: string): Promise<number | null> {
  return ttsCore.sendViaPlainTransport(wavPath, roomId, {
    rtcPort: RTC_PORT,
    ssrc: SSRC,
  });
}


// TTS_BROADCAST_MEDIASOUP=true なら Aivis 合成 WAV を mediasoup PlainTransport
// でも broadcast (transceiver gateway 受信機向けの legacy 互換)。default false。
const BROADCAST_MEDIASOUP = process.env.TTS_BROADCAST_MEDIASOUP === 'true';

// --- キュー管理（同時読み上げ防止）---
interface QueueItem {
  roomId: string;
  text: string;
  modelUuid: string;
  /** ★ #444: どれで合成するか。★★ 配信より後ろは同じ形 */
  engine: TtsEngine;
  /** ★ 2026-09-26: ルームで選んだ声 */
  voice?: string;
}

const queue: QueueItem[] = [];
let isProcessing = false;

async function processQueue(): Promise<void> {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { roomId, text, modelUuid, engine, voice } = queue.shift()!;

    let wavBuf: Buffer;
    let contentType = 'audio/wav';
    try {
      const startTime = Date.now();
      // ★ 分岐は synthesizeByEngine に集約 (#444 段 2)。★★ ここで 2 度目を書かない
      const got = await synthesizeByEngine(engine, text, modelUuid, voice);
      wavBuf = got.buffer;
      contentType = got.contentType;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`[TTS] 合成OK (${(wavBuf.length / 1024).toFixed(0)}KB, ${elapsed}s, ${engine}) → room ${roomId}`);
    } catch (err) {
      // 合成失敗 → browser TTS に fallback (★ engine によらず同じ形)
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TTS] 合成エラー (${engine}): ${msg}, falling back to browser TTS`);
      try {
        await pushTtsSpeak(roomId, text);
      } catch (e2) {
        logger.warn(`[TTS] browser fallback also failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
      continue;
    }

    // Primary: Socket.IO blob 配信 (rtc 非依存、新設計の主経路)
    try {
      await pushTtsAudio(roomId, wavBuf, contentType);
      logger.info(`[TTS] Socket.IO 配信完了 → room ${roomId}`);
    } catch (err) {
      // Socket.IO 配信失敗 → browser TTS に fallback
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TTS] Socket.IO 配信失敗: ${msg}, falling back to browser TTS`);
      try {
        await pushTtsSpeak(roomId, text);
      } catch (e2) {
        logger.warn(`[TTS] browser fallback also failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
      // mediasoup 並走も意味がないので skip
      continue;
    }

    // Optional: mediasoup broadcast (TTS_BROADCAST_MEDIASOUP=true、transceiver gateway 受信機向け)
    // ★ #444: mediasoup 経路は .wav 前提 (tmp file の拡張子が固定)。wav 以外は流さない。
    if (BROADCAST_MEDIASOUP && contentType.startsWith('audio/wav')) {
      const tmpFile = path.join(import.meta.dirname, `../../.tts-tmp-${Date.now()}.wav`);
      try {
        fs.writeFileSync(tmpFile, wavBuf);
        await sendViaPlainTransport(tmpFile, roomId);
        logger.info(`[TTS] mediasoup 配信完了 → room ${roomId}`);
      } catch (err) {
        // mediasoup 失敗は warning のみ — 主経路 (Socket.IO) は成功している
        logger.warn(`[TTS] mediasoup 配信失敗 (Socket.IO は成功): ${err instanceof Error ? err.message : String(err)}`);
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
export function speakMessage(roomId: string, content: string): void {
  if (!TTS_ENABLED) return;

  // エラーメッセージはスキップ
  if (/^[❌⚠️]/.test(content)) return;

  const text = preprocessText(content);
  if (!text) return;

  // ★ 2026-09-26: ルームの設定 (エンジン・声) に従う。全体が browser / none のときはルームの設定は効かない
  const r = resolveRoomTts(config.TTS_PROVIDER, readRoomTtsSettings(roomId));

  if (r.mode === 'none') return;

  if (r.mode === 'browser') {
    // Server に通知 → server が Socket.IO で room に emit → 各 client が Web Speech で発声
    pushTtsSpeak(roomId, text).catch((err) => {
      logger.warn(`[TTS] browser provider notify failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    return;
  }

  // ★ エンジンの鍵が無ければ browser に fallback (★ 黙って止まらない)
  const key = r.engine === 'openai' ? config.OPENAI_API_KEY : r.engine === 'gemini' ? config.GOOGLE_API_KEY : AIVIS_API_KEY;
  if (!key) {
    logger.warn(`[TTS] ${r.engine} selected but its API key is not set, falling back to browser (room: ${roomId})`);
    pushTtsSpeak(roomId, text).catch(() => {});
    return;
  }

  const modelUuid = r.engine === 'aivis' ? (r.modelUuid || MODEL_UUID) : '';
  const voice = r.mode === 'server' ? r.voice : undefined;
  const shown = r.engine === 'aivis' ? modelUuid
    : r.engine === 'openai' ? `${OPENAI_TTS_MODEL} / ${voice || OPENAI_TTS_VOICE}`
    : `${GEMINI_TTS_MODEL || '(既定)'} / ${voice || GEMINI_TTS_VOICE || '(既定)'}`;
  logger.info(`[TTS] ${r.engine}: ${shown} (room: ${roomId})`);
  queue.push({ roomId, text, modelUuid, engine: r.engine, voice });
  processQueue();
}
