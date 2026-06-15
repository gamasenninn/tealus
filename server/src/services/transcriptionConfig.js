const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const CONFIG_PATH = process.env.TRANSCRIPTION_GUIDELINE_PATH
  || path.join(__dirname, '../../config/transcription_guideline.json');

const EMPTY = { version: 1, whisper_context: '', vocabulary: [], guidelines: [] };

let cached = null;
// #286 follow-up: ファイル mtime を保持し、変化時のみ再読込 (= admin token / reload endpoint
// なしでファイル更新を自動反映。7 日ごとの JWT 失効 + curl 不可の運用摩擦を構造的に解消)。
let cachedMtimeMs = null;

function loadGuideline() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      cached = EMPTY;
      cachedMtimeMs = null;
      return cached;
    }
    const mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
    // cache 済 かつ mtime 不変 → そのまま返す (1 文字起こしあたり statSync 1 回のみ)
    if (cached && cachedMtimeMs === mtimeMs) return cached;

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cached = {
      version: parsed.version || 1,
      whisper_context: typeof parsed.whisper_context === 'string' ? parsed.whisper_context : '',
      vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [],
      guidelines: Array.isArray(parsed.guidelines) ? parsed.guidelines : [],
    };
    cachedMtimeMs = mtimeMs;
    logger.info(`Loaded transcription guideline: ${cached.vocabulary.length} vocab, ${cached.guidelines.length} rules`);
    return cached;
  } catch (err) {
    logger.error('Failed to load transcription guideline, using empty:', err.message);
    cached = EMPTY;
    cachedMtimeMs = null;
    return cached;
  }
}

function resetCache() {
  cached = null;
  cachedMtimeMs = null;
}

function buildWhisperPrompt(config, model = null) {
  // Whisper の prompt parameter は style/spelling bias であって辞書ではない。
  // vocabulary を強く渡すと隣接音が歪む (例: 「ビレッジ側」→「ビレッジガン」)、
  // この特性は **model 依存** で、whisper-1 / gpt-4o-transcribe では bias 観測されたが、
  // gpt-4o-mini-transcribe では vocabulary を渡すと「業務連絡 / 冷蔵コンテナ / アシストさん」等の
  // 固有名詞認識が改善することが 5/9 検証で確認された (#269 Phase 1 finding)。
  //
  // Phase 2 実装: model-aware vocab inject。WHISPER_VOCAB_INJECT_MODELS env で list 指定、
  // 該当 model のとき vocabulary を whisper_context に追加。non-該当 model は従来通り
  // whisper_context のみ (vocab は AI 整形段階で正規化)。
  //
  // 安全層:
  // - default WHISPER_VOCAB_INJECT_MODELS は 'gpt-4o-mini-transcribe' のみ (5/9 verify 済)
  // - 200 char 上限 (Whisper prompt token budget)
  // - 議事録など gpt-4o-transcribe 用途は無変更 (default 維持)
  const { whisper_context, vocabulary } = config;

  // default は新世代 transcribe 2 model (5/12 dogfood で gpt-4o-mini-transcribe 完璧、
  // gpt-4o-transcribe も同世代兄弟で bias なしと期待、whisper-1 は legacy で除外)
  const VOCAB_INJECT_MODELS = (process.env.WHISPER_VOCAB_INJECT_MODELS
    || 'gpt-4o-mini-transcribe,gpt-4o-transcribe').split(',').map((s) => s.trim()).filter(Boolean);
  const shouldInjectVocab = model && VOCAB_INJECT_MODELS.includes(model)
    && Array.isArray(vocabulary) && vocabulary.length > 0;

  let prompt = whisper_context || '';
  if (shouldInjectVocab) {
    const terms = vocabulary.map((v) => v.term).filter(Boolean).join('、');
    prompt = prompt ? `${prompt} 用語: ${terms}` : `用語: ${terms}`;
  }

  if (!prompt) return null;

  // Model-aware truncation (#269 Phase 2 follow-up、5/12 user dogfood で判明):
  // - whisper-1: 224 token (最終 224 のみ参照、それ以前は無視されるという legacy 仕様)
  // - gpt-4o-transcribe / gpt-4o-mini-transcribe: 16,000 token (新世代、whisper-1 の 74 倍)
  //
  // 日本語 1 char ≈ 1-1.5 token、安全側で:
  //   legacy (whisper-1 or unknown model) → 200 char (~140-200 token)
  //   new gen (gpt-4o-* transcribe)        → 2000 char (~1400-2000 token、16000 token の 1/8)
  //
  // truncate 方向は slice(0, N) で先頭保持に変更 (旧 slice(-N) は末尾保持で whisper_context
  // 冒頭が削れる問題あり、辞書 inject 順序的に先頭 = whisper_context + 重要 term の方が自然)。
  const isLegacyModel = !model || model === 'whisper-1';
  const MAX_CHARS = isLegacyModel ? 200 : 2000;
  return prompt.length > MAX_CHARS ? prompt.slice(0, MAX_CHARS) : prompt;
}

function buildFormattingExtension(config) {
  const { vocabulary, guidelines } = config;
  if (!vocabulary.length && !guidelines.length) return '';

  const lines = [];
  if (vocabulary.length) {
    lines.push('');
    lines.push('組織固有語彙 (正規表記、転写ブレがあれば置き換える):');
    for (const v of vocabulary) {
      const aliases = Array.isArray(v.aliases) && v.aliases.length
        ? ` (転写ブレ例: ${v.aliases.join(', ')})`
        : '';
      const cat = v.category ? `[${v.category}] ` : '';
      lines.push(`- ${cat}${v.term}${aliases}`);
    }
  }
  if (guidelines.length) {
    lines.push('');
    lines.push('追加ガイドライン:');
    for (const g of guidelines) {
      lines.push(`- ${g}`);
    }
  }
  return lines.join('\n');
}

/**
 * Whisper prompt hallucination 検出
 *
 * Whisper API は音声内容が薄い (無音 / ノイズ / 短すぎる発話) 場合、
 * prompt として渡した文字列を **そのまま echo して返す** known issue がある。
 * vocab inject で prompt が太くなったため、leak が surface しやすくなった。
 *
 * 検出: rawText が whisperPrompt 全体、または whisperPrompt の冒頭 (whisper_context 部分)
 * と完全一致する場合、prompt hallucination と判定。
 *
 * @param {string} rawText - Whisper API の出力
 * @param {string|null} whisperPrompt - Whisper に渡した prompt
 * @returns {boolean}
 */
function isWhisperPromptHallucination(rawText, whisperPrompt) {
  if (!rawText || !whisperPrompt) return false;
  const raw = rawText.trim();
  const prompt = whisperPrompt.trim();
  if (raw === prompt) return true;
  // whisper_context 部分のみ (vocab inject 前の文脈) と一致するか
  const contextOnly = prompt.split(' 用語:')[0].trim();
  if (contextOnly && raw === contextOnly) return true;
  // raw が prompt の冒頭部分と一致 (prompt の prefix を echo)
  if (prompt.startsWith(raw) && raw.length >= 10) return true;
  return false;
}

/**
 * AI 整形が返してしまう「空文字を意味する Japanese literal」の検出。
 *
 * gpt-4o-mini が短い / 内容が薄い raw_text を整形する時、空文字を返す代わりに
 * 「空文字」「空文字列」「(空)」等のメタ description を返してしまう挙動が観測された。
 * これを検出して raw_text に fallback する。
 */
const META_EMPTY_LITERALS = [
  '空文字', '空文字列', '空白', '空',
  '(空)', '（空）', '(空文字)', '（空文字）',
  '内容なし', '内容無し', '無音', '(無音)', '（無音）',
  '(none)', 'none', 'null', 'empty',
];

function isMetaEmptyLiteral(text) {
  if (!text) return false;
  const trimmed = text.trim();
  return META_EMPTY_LITERALS.includes(trimmed);
}

module.exports = {
  loadGuideline,
  resetCache,
  buildWhisperPrompt,
  buildFormattingExtension,
  isWhisperPromptHallucination,
  isMetaEmptyLiteral,
  META_EMPTY_LITERALS,
};
