/**
 * Gemini TTS (Interactions API) で音声合成 (2026-09-26)
 *
 * ★ なぜ Gemini か (利用者の聞き比べ、2026-09-26):
 *   「Kore + 話し方の指定」がいちばん良かった。★★ 既定は **Lite** (`gemini-3.8-flash-lite-tts`):
 *   Flash は 7俵 を「ななたま」と読み、Lite は料金が 2/3 (出力 $6 / 100 万トークン、2027-01-01 から倍)。
 *   ★★★ ただし Lite も 7俵 を 3 回中 1 回しか正しく読まなかった → 読みは tts-reading.mts の表で当てる
 *
 * ★ 呼び出しの形は 2026-09-26 に実際に叩いて確かめた:
 *   POST /v1beta/interactions / 鍵は x-goog-api-key (★ URL に載せない = ログに鍵が出ない)
 *   音声は steps[].content[].data (base64 の WAV、24kHz mono 16bit)
 *   速さ: 約 14 秒の音声に 7〜9 秒 (Aivis 0.5 秒 / OpenAI 3.6 秒)
 *
 * ★★ tts-openai.mts と同じく **tts-core.mts には足さない** (rtc-server との共有面を広げない、docs/05:423)。
 * ★★★ 送った本文は Google に渡る。**有料プランの鍵であること** (無料枠は製品改善に使われる) を利用者が確認済み (2026-09-26)。
 *
 * @module lib/tts-gemini
 */
import { logger } from './logger.mts';
import { splitForTts as split, concatWav, mapLimited } from './tts-chunk.mts';

// ★ 既存のテストがここから読むので再公開する
export { concatWav };
export const splitForTts = (text: string, max: number = MAX_CHUNK_CHARS): string[] => split(text, max);

export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const DEFAULT_MODEL = 'gemini-3.8-flash-lite-tts';
export const DEFAULT_VOICE = 'Kore';
/** ★ 利用者がいちばん良いと判定した話し方 (2026-09-26) */
export const DEFAULT_STYLE = '落ち着いた職場の業務連絡として、はっきり、やや速めに';
const SAMPLE_RATE = 24000;

/**
 * ★ 長い文は分けて並行に合成する (2026-09-26)。
 *
 * ★ なぜ: 本番切替の直後、読み上げボタン (全文、最大 3000 字) が 30 秒で時間切れになった。
 *   Gemini は長さに比例して遅い (自然な文で 250 字 12 秒 / 600 字 26 秒 / 1200 字 37 秒)。
 * ★★ 回数制限は **1 分 10 回** (Tier 1、429 で判明)。→ かけらは 600 字、同時 5 本 = 3000 字でも 5 回・1 巡。
 *
 * ★★★★ 訂正 (2026-09-26): いったん「1 回 40〜50 秒を超えた分は黙って読まれない」と結論し 250 字にしたが、
 *   **同じ文を繰り返した試験文のせいで出た見かけ**だった (TTS も文字起こしも繰り返しで飛ばす・ループする)。
 *   繰り返しの無い自然な文 (docs/00) では 1200 字を 1 回で 182 秒・聞き戻し再現率 94%。
 *   ★ 長さの試験に同じ文の繰り返しを使わないこと。
 */
export const MAX_CHUNK_CHARS = 600;
export const MAX_PARALLEL = 5;


export interface SynthesizeGeminiOptions {
  apiKey?: string;
  model?: string;
  voice?: string;
  /** ★ 話し方の指定。**空文字なら付けない** (undefined は既定を使う) */
  style?: string;
  timeout?: number;
  /** test 用の fetch 差し替え (★ 既定は global fetch) */
  fetchImpl?: typeof globalThis.fetch;
}

export interface GeminiTtsResult {
  buffer: Buffer;
  contentType: string;
}

/** 応答の中の最初の音声 (base64) を探す。★ 場所は steps[].content[].data */
function findAudio(json: unknown): string | null {
  const steps = (json as { steps?: { content?: { data?: unknown }[] }[] })?.steps ?? [];
  for (const step of steps) {
    for (const c of step.content ?? []) {
      if (typeof c.data === 'string' && c.data.length > 0) return c.data;
    }
  }
  return null;
}

/**
 * Gemini で音声合成する。
 *
 * ★ 失敗は **必ず throw** する (★★ 呼び出し側が browser TTS に fallback するため)。
 *   ★★★ 200 でも音声が入っていなければ throw —— 空の buffer を返すと「鳴らない」と「落ちた」が区別できない。
 */
export async function synthesizeGemini(
  text: string,
  opts: SynthesizeGeminiOptions = {},
): Promise<GeminiTtsResult> {
  if (!opts.apiKey) throw new Error('GOOGLE_API_KEY が設定されていません');
  if (!text) throw new Error('text が空です');
  if (!(opts.fetchImpl || globalThis.fetch)) throw new Error('fetch が利用できません');

  const chunks = splitForTts(text);
  if (chunks.length === 1) return { buffer: await synthesizeOne(text, opts), contentType: 'audio/wav' };

  // ★ 長い文: 分けて並行 → 元の順でつなぐ。★★ 1 つでも失敗したら throw (欠けた音声を返さない)
  const t0 = Date.now();
  const wavs = await mapLimited(chunks, MAX_PARALLEL, (c) => synthesizeOne(c, opts));
  const buffer = concatWav(wavs);
  logger.info(`[TTS/gemini] ${text.length} 字を ${chunks.length} 分割・同時 ${MAX_PARALLEL} 本で合成 (${Date.now() - t0}ms)`);
  return { buffer, contentType: 'audio/wav' };
}

/** 1 回分の合成 (★ 分けたかけら 1 つ、または短い文そのもの) */
async function synthesizeOne(
  text: string,
  // ★ 600 字で約 26 秒 (自然な文、2026-09-26 実測)。余裕を見て 60 秒
  { apiKey, model, voice, style, timeout = 60000, fetchImpl }: SynthesizeGeminiOptions,
): Promise<Buffer> {
  const doFetch = (fetchImpl || globalThis.fetch)!;

  const s = style === undefined ? DEFAULT_STYLE : style;
  const res = await doFetch(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      input: [{
        type: 'user_input',
        content: [{ type: 'text', text, ...(s ? { annotations: [{ type: 'speech_metadata', style: s }] } : {}) }],
      }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: SAMPLE_RATE },
      generation_config: { speech_config: [{ voice: voice || DEFAULT_VOICE }] },
    }),
    signal: AbortSignal.timeout(timeout),
  } as RequestInit);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini TTS error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const audio = findAudio(await res.json());
  if (!audio) throw new Error('Gemini TTS: 応答に音声が入っていません');
  const buffer = Buffer.from(audio, 'base64');
  logger.debug(`[TTS/gemini] ${(buffer.length / 1024).toFixed(0)}KB audio/wav`);
  return buffer;
}
