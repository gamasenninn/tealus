import fs from 'node:fs';
import { logger as defaultLogger } from '../utils/logger.mts';

/**
 * STT backend strategy (#自ホストSTT)
 *
 * 「音声ファイル -> raw text」の 1 ステップを backend で切替する。
 *   STT_BACKEND = 'openai' (default) | 'local'
 *   - openai: 従来どおり OpenAI transcription API (gpt-4o-mini-transcribe 等) に送る。
 *   - local : 常駐 Qwen3-ASR ワーカー (localhost HTTP) に file path を渡して自ホスト推論。
 *
 * 非破壊方針: 既定 'openai' で現行と完全同一。local はワーカー障害時に openai へ
 * fail-open (STT_LOCAL_STRICT=1 で fallback せず throw に切替可)。
 * 速度計測 (2026-07-03, 同一9本): local 常駐ワーカー median 1279ms ≈ openai API median 1384ms。
 *
 * DB 非依存・グローバル state なし (test isolation は依存注入で担保)。
 */

const CONTENT_TYPE: Record<string, string> = {
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPE[ext] || `audio/${ext}`;
}

// 言語誤検出ガード (2026-07-04 dogfood): 多言語 audio-LLM (Qwen3-ASR 等) は短いクリップで
// 言語を誤検出し、別言語を出すことがある (「高梨さん取れますか」→「حسن」アラビア語、決定論的で
// prompt では回避不能と判明)。日本語業務音声で出るはずのない外来スクリプト (アラビア/キリル/
// ハングル/タイ/デーヴァナーガリー等) を検出したら STT 失敗扱いにして openai へ fallback する。
// ラテン頭字語 (OK/NTS 等) や日本語は許容 = 誤検出しない。
// Cyrillic Ѐ-ԯ / Arabic+Syriac ؀-ݏ / Devanagari ऀ-ॿ /
// Thai ฀-๿ / Hangul syllables 가-힯
const FOREIGN_SCRIPT_RE = /[Ѐ-ԯ؀-ݏऀ-ॿ฀-๿가-힯]/;
export function looksLikeForeignScript(text: unknown): boolean {
  return typeof text === 'string' && FOREIGN_SCRIPT_RE.test(text);
}

/** log 注入用の最小 logger 形 (既定は winston logger、テストで差し替え可) */
interface SttLogger {
  warn: (message: string) => unknown;
  error: (message: string) => unknown;
}

/** openaiClient 注入用の最小 OpenAI client 形 (openai.audio.transcriptions.create) */
export interface OpenAIAudioClient {
  audio: {
    transcriptions: {
      create(params: {
        file: File;
        model: string;
        language: string;
        prompt?: string;
      }): Promise<{ text?: string | null }>;
    };
  };
}

export interface TranscribeAudioParams {
  /** 変換済み音声ファイルの絶対 path (worker/openai 双方が使う) */
  inputPath: string;
  /** 拡張子 (content-type 判定用) */
  ext: string;
  /** openai backend の prompt (bias)。空なら渡さない */
  whisperPrompt: string | null;
  /** openai model 名 (WHISPER_MODEL) */
  model: string;
  /** local backend の固有名詞 glossary (system prompt biasing) */
  glossary?: string;
  /** OpenAI SDK instance (openai.audio.transcriptions.create) */
  openaiClient: OpenAIAudioClient;
  /**
   * backend override ('openai'|'local')。未指定なら STT_BACKEND env を読む
   * (TRANSCRIPTION_MODE=organon が STT を local に束ねるため)
   */
  backend?: string;
  /** local backend の HTTP (test で注入)。default globalThis.fetch */
  fetchImpl?: typeof globalThis.fetch;
  /** default logger */
  log?: SttLogger;
}

/**
 * @returns raw text
 */
export async function transcribeAudio({
  inputPath,
  ext,
  whisperPrompt,
  model,
  glossary,
  openaiClient,
  backend,
  fetchImpl = globalThis.fetch,
  log = defaultLogger,
}: TranscribeAudioParams): Promise<string> {
  const effectiveBackend = (backend || process.env.STT_BACKEND || 'openai').toLowerCase();

  if (effectiveBackend === 'local') {
    try {
      const text = await transcribeLocal({ inputPath, glossary, fetchImpl });
      if (looksLikeForeignScript(text)) {
        throw new Error(`worker returned foreign-script text (language misdetection): "${text.slice(0, 20)}"`);
      }
      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const strict = !!process.env.STT_LOCAL_STRICT && process.env.STT_LOCAL_STRICT !== '0';
      if (strict) {
        log.error(`[stt] local backend failed (STT_LOCAL_STRICT): ${message}`);
        throw err;
      }
      log.warn(`[stt] local backend failed, falling back to openai: ${message}`);
      // fall through to openai
    }
  }

  return transcribeOpenAI({ inputPath, ext, whisperPrompt, model, openaiClient });
}

async function transcribeLocal({ inputPath, glossary, fetchImpl }: {
  inputPath: string;
  glossary?: string;
  fetchImpl: typeof globalThis.fetch;
}): Promise<string> {
  const url = process.env.QWEN_WORKER_URL || 'http://127.0.0.1:8123/transcribe';
  const timeoutMs = Number(process.env.STT_LOCAL_TIMEOUT_MS || 60000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: inputPath, ...(glossary ? { glossary } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`worker HTTP ${res.status}`);
    }
    const data = (await res.json()) as { text?: unknown; error?: unknown } | null;
    if (data == null || typeof data.text !== 'string') {
      throw new Error(`worker returned no text (${data && data.error ? data.error : 'malformed'})`);
    }
    return data.text;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeOpenAI({ inputPath, ext, whisperPrompt, model, openaiClient }: {
  inputPath: string;
  ext: string;
  whisperPrompt: string | null;
  model: string;
  openaiClient: OpenAIAudioClient;
}): Promise<string> {
  const fileBuffer = fs.readFileSync(inputPath);
  const file = new File([fileBuffer], `audio.${ext}`, { type: contentTypeFor(ext) });
  const transcription = await openaiClient.audio.transcriptions.create({
    file,
    model,
    language: 'ja',
    ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
  });
  return transcription.text || '';
}
