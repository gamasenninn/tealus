import fs from 'node:fs';
import { logger as defaultLogger } from '../utils/logger.mts';

/**
 * STT backend strategy (#自ホストSTT)
 *
 * 「音声ファイル -> raw text」の 1 ステップを backend で切替する。
 *   STT_BACKEND = 'openai' (default) | 'local' | 'gemini'
 *   - openai: 従来どおり OpenAI transcription API (gpt-4o-mini-transcribe 等) に送る。
 *   - local : 常駐 Qwen3-ASR ワーカー (localhost HTTP) に file path を渡して自ホスト推論。
 *   - gemini: gemini-3.5-transcribe + 辞書語彙 (custom_vocabulary) (#424)。
 *     ★ 2026-09-07 実測 (37 便): 固有名詞 現行 50% → 85%。差は全部 音響段語彙から。
 *
 * 非破壊方針: 既定 'openai' で現行と完全同一。local / gemini は障害時に openai へ
 * fail-open (local は STT_LOCAL_STRICT=1 で fallback せず throw に切替可)。
 * 速度計測 (2026-07-03, 同一9本): local 常駐ワーカー median 1279ms ≈ openai API median 1384ms。
 * gemini は 2〜7 秒/便 (2026-09-07 実測)。
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

// 中国語誤検出ガード (#332, 2026-07-14 朝礼 dogfood): Qwen3-ASR が日本語音声を中国語と誤検出し
// 「每句一个」等を吐く。漢字は日本語と重なるため looksLikeForeignScript は意図的に除外しており、
// この穴をすり抜ける。正常な日本語文字起こしは助詞など「かな」を必ず含むので、
//   かな(ひらがな/カタカナ) を1字も含まない かつ (簡体字専用字を含む OR 漢字が一定長以上)
// を中国語誤検出扱いにする。短い全漢字の正当日本語 (了解/承知/型式番号) は簡体字なし+短いので誤爆しない。
// ひらがな 3040-309F / カタカナ 30A0-30FF / 半角カナ FF66-FF9D
const KANA_RE = /[぀-ヿｦ-ﾝ]/;
// 日本語に現れない簡体字専用字 (Qwen 中国語 hallucination の marker)。日本語の新字体・旧字体とは字形が異なるものだけ。
const SIMPLIFIED_ONLY_RE = /[个这么们吗说请谢语见现关门问间时电话车书东让觉图员长马鸟们儿网页样对经济]/;
const HAN_RE = /[一-鿿]/g;
// かな皆無で漢字がこの数以上 = 助詞のない長文 = 日本語ではありえない (誤検出扱い)。
const KANA_LESS_HAN_LIMIT = 8;
export function looksLikeChineseMisdetection(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  if (KANA_RE.test(t)) return false; // 正常な日本語は必ずかなを含む
  if (SIMPLIFIED_ONLY_RE.test(t)) return true; // 簡体字専用字 → 確実に中国語
  return (t.match(HAN_RE) || []).length >= KANA_LESS_HAN_LIMIT; // かな皆無で漢字が長い
}

/** log 注入用の最小 logger 形 (既定は winston logger、テストで差し替え可) */
interface SttLogger {
  warn: (message: string) => unknown;
  error: (message: string) => unknown;
  /** gemini 成功時の計測跡 (#424)。省略可 — テストの log 注入を壊さない */
  info?: (message: string) => unknown;
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
  /**
   * gemini backend の語彙 (custom_vocabulary、#424)。buildVocabularyTerms() の戻り。
   * ★ 空なら gemini は使われない (語彙なし Gemini 47% は現行 50% より悪い実測)
   */
  vocabTerms?: string[];
  /**
   * ★ 動画から抽出した音声か (#424)。true なら gemini に送らず openai 経路。
   * 実測は 33 秒以下の voice クリップのみで、10〜20 分の朝礼音声は未測定。
   * 抽出 mp3 は 1MB 程度なのでサイズでは分離できず、フラグで明示する。
   */
  videoAudio?: boolean;
  /** OpenAI SDK instance (openai.audio.transcriptions.create) */
  openaiClient: OpenAIAudioClient;
  /**
   * backend override ('openai'|'local'|'gemini')。未指定なら STT_BACKEND env を読む
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
  vocabTerms,
  videoAudio,
  openaiClient,
  backend,
  fetchImpl = globalThis.fetch,
  log = defaultLogger,
}: TranscribeAudioParams): Promise<string> {
  const effectiveBackend = (backend || process.env.STT_BACKEND || 'openai').toLowerCase();

  // #424 gemini: 語彙つき音響段。★ 使わない条件 3 つは静かに openai へ (fail-open とは別の「対象外」)
  //   - videoAudio: 実測した範囲 (短い voice クリップ) の外
  //   - 語彙 0 件: 語彙なし Gemini は現行より悪い実測
  //   - 鍵なし: 設定ミスで文字起こしを止めない (warn だけ残す)
  if (effectiveBackend === 'gemini' && !videoAudio && vocabTerms && vocabTerms.length > 0) {
    if (!process.env.GEMINI_API_KEY) {
      log.warn('[stt] gemini backend selected but GEMINI_API_KEY is not set, falling back to openai');
    } else {
      try {
        const started = Date.now();
        const text = await transcribeGemini({ inputPath, ext, vocabTerms, fetchImpl });
        if (!text) {
          // ★ 空も fallback する — gemini が静かに壊れたとき (鍵切れ・応答形の変更) に
          //   全便が空になる事故を防ぐ。無音便は openai 側でも空になるので実害なし。
          throw new Error('gemini returned empty text');
        }
        const truncation = looksTruncated(inputPath, text);
        if (truncation) {
          throw new Error(`gemini output looks truncated (${truncation})`);
        }
        log.info?.(`[stt] gemini ok ${Date.now() - started}ms vocab=${vocabTerms.length} chars=${text.length}`);
        return text;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`[stt] gemini backend failed, falling back to openai: ${message}`);
        // fall through to openai
      }
    }
  }

  if (effectiveBackend === 'local') {
    try {
      const text = await transcribeLocal({ inputPath, glossary, fetchImpl });
      if (looksLikeForeignScript(text)) {
        throw new Error(`worker returned foreign-script text (language misdetection): "${text.slice(0, 20)}"`);
      }
      if (looksLikeChineseMisdetection(text)) {
        throw new Error(`worker returned kana-less CJK text (Chinese misdetection): "${text.slice(0, 20)}"`);
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

/**
 * #424 gemini-3.5-transcribe を叩く。
 *
 * ★ 入口は interactions に固定 — generateContent は transcription_config を受けない (実測 400)。
 * ★ 応答は steps[].content[].text (generateContent の candidates とは形が違う)。
 * ★ エラー本文は切り詰めない — 429 の本文には「どの上限か」が書いてあり、
 *   切ると読めなくなる (2026-09-07、これで 3 日費やした)。
 */
async function transcribeGemini({ inputPath, ext, vocabTerms, fetchImpl }: {
  inputPath: string;
  ext: string;
  vocabTerms: string[];
  fetchImpl: typeof globalThis.fetch;
}): Promise<string> {
  const model = process.env.STT_GEMINI_MODEL || 'gemini-3.5-transcribe';
  const timeoutMs = Number(process.env.STT_GEMINI_TIMEOUT_MS || 30000);
  const body = {
    model,
    input: [{ type: 'audio', data: fs.readFileSync(inputPath).toString('base64'), mime_type: contentTypeFor(ext) }],
    generation_config: {
      transcription_config: { language_codes: ['ja-JP'], custom_vocabulary: vocabTerms },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as
      { steps?: Array<{ content?: Array<{ text?: string }> }>; error?: { message?: string } } | null;
    if (!res.ok) {
      // ★★ 本文を丸ごと残す (2026-09-08)。429 の message は 2 行目に
      //   「Quota exceeded for metric: … limit: N」を持ち、**そこにしか枠の種類が書いていない**
      //   (free_tier なのか per_model_per_day なのか)。
      //   ★ 当初 error.message だけを使っていて、実運用の 429 四件でどの上限か判別できなかった。
      //   ★★ 改行は潰す —— ログの 1 行として grep できないと、結局読めないのは同じ。
      //   message が無い形のエラーもありうるので、その場合は本文そのものを出す (握りつぶさない)。
      const detail = data?.error?.message || (data ? JSON.stringify(data) : '');
      throw new Error(`gemini HTTP ${res.status}${detail ? `: ${detail.replace(/\s*\n\s*/g, ' ')}` : ''}`);
    }
    return (data?.steps || []).flatMap((s) => s.content || []).map((c) => c.text || '').join('').trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ★ #424 切断ガード — 「呼びかけだけ残して用件が消える」型の検出。
 *
 * 実測 2 件 (2026-09-07): 28 秒の音声 → 10 字 / 13 秒 → 15 字。どちらも本題側が丸ごと落ちた。
 * 閾値: 10 秒以上 かつ 1.5 字/秒未満。誤検知の代償は openai 呼び出し 1 回 (= 現行と同じ結果)
 * なので安全側。★ wav 以外 (webm/mp4) は byteRate が読めないのでガードしない (fail-open は別で効く)。
 *
 * @returns 切断疑いなら理由文字列、問題なければ null
 */
const TRUNCATION_MIN_SEC = 10;
const TRUNCATION_MIN_CHARS_PER_SEC = 1.5;
function looksTruncated(inputPath: string, text: string): string | null {
  const sec = readWavDurationSec(inputPath);
  if (sec === null || sec < TRUNCATION_MIN_SEC) return null;
  const rate = text.length / sec;
  if (rate < TRUNCATION_MIN_CHARS_PER_SEC) {
    return `${sec.toFixed(1)}s audio but only ${text.length} chars (${rate.toFixed(2)} chars/sec)`;
  }
  return null;
}

/** wav ヘッダから秒数を読む。wav でない / 読めないなら null (ガードしない側に倒す) */
function readWavDurationSec(inputPath: string): number | null {
  try {
    const fd = fs.openSync(inputPath, 'r');
    try {
      const header = Buffer.alloc(44);
      const read = fs.readSync(fd, header, 0, 44, 0);
      if (read < 44) return null;
      if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return null;
      const byteRate = header.readUInt32LE(28);
      if (!byteRate) return null;
      const dataBytes = fs.fstatSync(fd).size - 44;
      return dataBytes > 0 ? dataBytes / byteRate : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
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
