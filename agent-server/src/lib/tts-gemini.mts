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

export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const DEFAULT_MODEL = 'gemini-3.8-flash-lite-tts';
export const DEFAULT_VOICE = 'Kore';
/** ★ 利用者がいちばん良いと判定した話し方 (2026-09-26) */
export const DEFAULT_STYLE = '落ち着いた職場の業務連絡として、はっきり、やや速めに';
const SAMPLE_RATE = 24000;

/**
 * ★ 長い文は分けて並行に合成する (2026-09-26)。
 *
 * ★★★★ **1 回の合成で作れる音声は 40〜50 秒ほどが上限。それを超えた分は黙って読まれない。**
 *   (2026-09-26 実測、gemini-3.8-flash-lite-tts)
 *   ```
 *   250 字 → 37.5 秒 (6.7 字/秒、全部読めた)
 *   500 字 → 48 秒   (本来 75 秒。後ろが切れた)
 *   2000 字を 800 字 × 3 で → 89 秒、「業務連絡」25 回中 7 回しか読まれていない (聞き戻して確認)
 *   ```
 *   → ★ かけらは **250 字** (全部読めると確かめた長さ)。
 * ★★★ **回数制限は 1 分 10 回** (Tier 1、429 で判明)。250 字ずつだと 2500 字で 10 回に達する。
 *   ★ 自動の読み上げは 1 日 0〜3 回・1 分に最多 2 回 (09-20〜09-26 実測) で、普段は遠い。
 * ★★★★ この 2 つが解けるまで本番は Aivis に戻した (2026-09-26、利用者判断「更新を期待して残す」)。
 */
export const MAX_CHUNK_CHARS = 250;
export const MAX_PARALLEL = 4;

/** ★ ここで切ってよい文字 (★ 直後で切る)。句点・感嘆・疑問・改行 */
const SENTENCE_END = /[。！？!?\n]/;
/** ★ 句点が無いときの次善 */
const SOFT_END = /[、，,　 ]/;

/**
 * 文の切れ目で分ける。★★★ `join('')` で元に戻る (1 文字も欠けない) ことをテストで固定している。
 * ★ 1 つは max 字以下。句点の直後で切り、無ければ読点の直後、それも無ければ字数で切る。
 */
export function splitForTts(text: string, max: number = MAX_CHUNK_CHARS): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let cut = -1;
    for (let i = head.length - 1; i >= 0; i--) if (SENTENCE_END.test(head[i])) { cut = i + 1; break; }
    if (cut <= 0) for (let i = head.length - 1; i >= 0; i--) if (SOFT_END.test(head[i])) { cut = i + 1; break; }
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) out.push(rest);
  // ★ 空白だけのかけら (改行の連続など) は前のかけらに寄せる (★ 合成に投げない、でも文字は欠かさない)
  const merged: string[] = [];
  for (const p of out) {
    if (!p.trim() && merged.length) merged[merged.length - 1] += p;
    else merged.push(p);
  }
  return merged;
}

/** WAV から fmt と data (PCM) を取り出す。★ data の前に LIST 等があっても読み飛ばす */
function readWav(buf: Buffer): { fmt: Buffer; pcm: Buffer } {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Gemini TTS: WAV ではない音声が返った');
  }
  let fmt: Buffer | null = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
    if (id === 'fmt ') fmt = Buffer.from(body);
    if (id === 'data') {
      if (!fmt) throw new Error('Gemini TTS: WAV に fmt がない');
      return { fmt, pcm: body };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('Gemini TTS: WAV に data がない');
}

/** ★ WAV を順につなぐ。形式は 1 本目のものを使う (★ 同じモデル・同じ設定なので揃っている) */
export function concatWav(buffers: Buffer[]): Buffer {
  const parts = buffers.map(readWav);
  const fmt = parts[0].fmt;
  const pcm = Buffer.concat(parts.map((p) => p.pcm));
  const head = Buffer.alloc(12 + 8 + fmt.length + 8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(head.length - 8 + pcm.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(fmt.length, 16);
  fmt.copy(head, 20);
  head.write('data', 20 + fmt.length, 'ascii');
  head.writeUInt32LE(pcm.length, 24 + fmt.length);
  return Buffer.concat([head, pcm]);
}

/** ★ 同時 limit 本までで順に処理し、結果は入力と同じ順で返す */
async function mapLimited<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

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
  // ★ 250 字でも 8〜15 秒と揺れる (2026-09-26 実測)。余裕を見て 60 秒
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
