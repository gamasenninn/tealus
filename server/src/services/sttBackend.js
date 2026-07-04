const fs = require('fs');
const defaultLogger = require('../utils/logger');

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

const CONTENT_TYPE = {
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
};

function contentTypeFor(ext) {
  return CONTENT_TYPE[ext] || `audio/${ext}`;
}

/**
 * @param {object} p
 * @param {string} p.inputPath   - 変換済み音声ファイルの絶対 path (worker/openai 双方が使う)
 * @param {string} p.ext         - 拡張子 (content-type 判定用)
 * @param {string} p.whisperPrompt - openai backend の prompt (bias)。空なら渡さない
 * @param {string} p.model       - openai model 名 (WHISPER_MODEL)
 * @param {string} [p.glossary]  - local backend の固有名詞 glossary (system prompt biasing)
 * @param {object} p.openaiClient - OpenAI SDK instance (openai.audio.transcriptions.create)
 * @param {string} [p.backend]   - backend override ('openai'|'local')。未指定なら STT_BACKEND env を読む
 *                                 (TRANSCRIPTION_MODE=organon が STT を local に束ねるため)
 * @param {function} [p.fetchImpl=globalThis.fetch] - local backend の HTTP (test で注入)
 * @param {object} [p.log=logger]
 * @returns {Promise<string>} raw text
 */
async function transcribeAudio({
  inputPath,
  ext,
  whisperPrompt,
  model,
  glossary,
  openaiClient,
  backend,
  fetchImpl = globalThis.fetch,
  log = defaultLogger,
}) {
  const effectiveBackend = (backend || process.env.STT_BACKEND || 'openai').toLowerCase();

  if (effectiveBackend === 'local') {
    try {
      return await transcribeLocal({ inputPath, glossary, fetchImpl });
    } catch (err) {
      const strict = !!process.env.STT_LOCAL_STRICT && process.env.STT_LOCAL_STRICT !== '0';
      if (strict) {
        log.error(`[stt] local backend failed (STT_LOCAL_STRICT): ${err.message}`);
        throw err;
      }
      log.warn(`[stt] local backend failed, falling back to openai: ${err.message}`);
      // fall through to openai
    }
  }

  return transcribeOpenAI({ inputPath, ext, whisperPrompt, model, openaiClient });
}

async function transcribeLocal({ inputPath, glossary, fetchImpl }) {
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
    const data = await res.json();
    if (data == null || typeof data.text !== 'string') {
      throw new Error(`worker returned no text (${data && data.error ? data.error : 'malformed'})`);
    }
    return data.text;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeOpenAI({ inputPath, ext, whisperPrompt, model, openaiClient }) {
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

module.exports = { transcribeAudio, contentTypeFor };
