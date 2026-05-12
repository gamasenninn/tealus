const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const CONFIG_PATH = process.env.TRANSCRIPTION_GUIDELINE_PATH
  || path.join(__dirname, '../../config/transcription_guideline.json');

const EMPTY = { version: 1, whisper_context: '', vocabulary: [], guidelines: [] };

let cached = null;

function loadGuideline() {
  if (cached) return cached;
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      cached = EMPTY;
      return cached;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cached = {
      version: parsed.version || 1,
      whisper_context: typeof parsed.whisper_context === 'string' ? parsed.whisper_context : '',
      vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [],
      guidelines: Array.isArray(parsed.guidelines) ? parsed.guidelines : [],
    };
    logger.info(`Loaded transcription guideline: ${cached.vocabulary.length} vocab, ${cached.guidelines.length} rules`);
    return cached;
  } catch (err) {
    logger.error('Failed to load transcription guideline, using empty:', err.message);
    cached = EMPTY;
    return cached;
  }
}

function resetCache() {
  cached = null;
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

  const VOCAB_INJECT_MODELS = (process.env.WHISPER_VOCAB_INJECT_MODELS
    || 'gpt-4o-mini-transcribe').split(',').map((s) => s.trim()).filter(Boolean);
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

module.exports = {
  loadGuideline,
  resetCache,
  buildWhisperPrompt,
  buildFormattingExtension,
};
