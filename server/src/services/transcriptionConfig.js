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

function buildWhisperPrompt(config) {
  // Whisper の prompt parameter は style/spelling bias であって辞書ではない。
  // vocabulary を強く渡すと隣接音が歪む (例: 「ビレッジ側」→「ビレッジガン」) ので、
  // ドメイン文脈 (whisper_context) のみ渡し、固有名詞の正規化は AI 整形に任せる。
  const { whisper_context } = config;
  if (!whisper_context) return null;

  const MAX_CHARS = 200;
  return whisper_context.length > MAX_CHARS
    ? whisper_context.slice(-MAX_CHARS)
    : whisper_context;
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
