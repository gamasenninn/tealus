/**
 * OpenAI TTS (`/v1/audio/speech`) で音声合成 (#444)
 *
 * ★★★★ **`tts-core.mts` には足さない。**
 *   `tts-core.mts` は **rtc-server から横断 import されている唯一の共有面**
 *   (`rtc-server/tts-speak.mts:26`)。★ docs/05:423 が「新たな横断依存は増やさない」と決めているので、
 *   ★★ 別ファイルにして共有面を広げない。
 *
 * ★ 既定の voice は **marin** —— ★★ 会話モード (Realtime) が既定で鳴らしている voice と同じ。
 *   ★★★ 2026-09-17 実測: `client_secrets` の応答に `audio.output.voice = "marin"` が入っていた。
 *   ★★★★ **同じ voice 名でも声質が同じとは限らない**が、利用者の聞き比べで「同等」判定済み。
 *
 * ★★ 既知の限界 (#446): **固有名詞の読みを渡す口が無い。**
 *   ★ 「鹿沼」を シカヌマ と読む (★★ Aivis は カヌマ と読める)。★★★ `instructions` では直らない (実測)。
 *   → ★ **本番切替 (段 3) の前に #446 を片付けること。**
 *
 * @module lib/tts-openai
 */
import { logger } from './logger.mts';
import { splitForTts, concatWav, mapLimited } from './tts-chunk.mts';

export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

/** 既定値 (★ env で差し替えられるが、既定は会話モードに揃える) */
export const DEFAULT_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_VOICE = 'marin';
export const DEFAULT_FORMAT = 'wav';

/**
 * ★ 長い文は分けて並行に合成する (2026-09-26、Gemini と同じ部品 = tts-chunk.mts)。
 *   1 回の入力は 2000 トークンまで (本番ログ「Input of 2003 tokens is over the maximum input limit」)。
 *   長さに比例して遅い (自然な文で 250 字 7 秒 / 600 字 14 秒 / 1200 字 29 秒)。
 * ★ 回数制限は 1 分 10,000 回 (応答の x-ratelimit-limit-requests、2026-09-26) なので回数は気にしなくてよい。
 * ★★ wav のときだけ分ける (mp3 などはつなげない)。
 */
export const MAX_CHUNK_CHARS = 600;
export const MAX_PARALLEL = 5;

/** response_format → Content-Type (★ 応答ヘッダが無いときの保険) */
const FORMAT_TO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
};

export interface SynthesizeOpenaiOptions {
  apiKey?: string;
  model?: string;
  voice?: string;
  format?: string;
  timeout?: number;
  /** test 用の fetch 差し替え (★ 既定は global fetch) */
  fetchImpl?: typeof globalThis.fetch;
}

export interface OpenaiTtsResult {
  buffer: Buffer;
  /** ★ 下流 (pushTtsAudio → server の cache) がそのまま使う */
  contentType: string;
}

/**
 * OpenAI で音声合成する。
 *
 * ★ 失敗は **必ず throw** する (★★ 呼び出し側が browser TTS に fallback するため)。
 *   ★★★ 黙って空の buffer を返さない —— 「鳴らない」と「落ちた」が区別できなくなる。
 */
export async function synthesizeOpenai(
  text: string,
  { apiKey, model, voice, format, timeout = 60000, fetchImpl }: SynthesizeOpenaiOptions = {},
): Promise<OpenaiTtsResult> {
  if (!apiKey) throw new Error('OPENAI_API_KEY が設定されていません');
  if (!text) throw new Error('text が空です');

  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('fetch が利用できません');

  const fmt = format || DEFAULT_FORMAT;
  const one = (t: string) => synthesizeOpenaiOne(t, { apiKey, model, voice, fmt, timeout, doFetch });
  const chunks = fmt === 'wav' ? splitForTts(text, MAX_CHUNK_CHARS) : [text];
  if (chunks.length === 1) return one(text);

  // ★ 長い文: 分けて並行 → 元の順でつなぐ。★★ 1 つでも失敗したら throw (欠けた音声を返さない)
  const t0 = Date.now();
  const parts = await mapLimited(chunks, MAX_PARALLEL, one);
  const buffer = concatWav(parts.map((p) => p.buffer));
  logger.info(`[TTS/openai] ${text.length} 字を ${chunks.length} 分割・同時 ${MAX_PARALLEL} 本で合成 (${Date.now() - t0}ms)`);
  return { buffer, contentType: 'audio/wav' };
}

/** 1 回分の合成 (★ 分けたかけら 1 つ、または短い文そのもの) */
async function synthesizeOpenaiOne(
  text: string,
  { apiKey, model, voice, fmt, timeout, doFetch }: { apiKey: string; model?: string; voice?: string; fmt: string; timeout: number; doFetch: typeof globalThis.fetch },
): Promise<OpenaiTtsResult> {
  const res = await doFetch(OPENAI_SPEECH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      voice: voice || DEFAULT_VOICE,
      input: text,
      response_format: fmt,
    }),
    signal: AbortSignal.timeout(timeout),
  } as RequestInit);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI TTS error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  // ★ 応答ヘッダを優先。無ければ format から決める (★★ 下流が Content-Type を必要とする)
  const contentType = res.headers.get('content-type') || FORMAT_TO_MIME[fmt] || 'application/octet-stream';
  logger.debug(`[TTS/openai] ${(buffer.length / 1024).toFixed(0)}KB ${contentType}`);
  return { buffer, contentType };
}
