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
  const { whisper_context, vocabulary } = config;
  if (!vocabulary.length && !whisper_context) return null;

  const terms = vocabulary.map(v => v.term).filter(Boolean);
  const parts = [];
  if (whisper_context) parts.push(whisper_context);
  if (terms.length) {
    parts.push(`会話には次の固有名詞が登場します: ${terms.join('、')}。`);
  }
  let prompt = parts.join(' ');

  // Whisper prompt は 224 token 上限 (last-224 wins)。
  // 日本語は概ね 1 文字 = 1-2 token。安全側で 200 文字 (~200-300 token 想定だが Whisper は最後の 224 を採用するので末尾優先で切る)。
  const MAX_CHARS = 200;
  if (prompt.length > MAX_CHARS) {
    prompt = prompt.slice(-MAX_CHARS);
  }
  return prompt;
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
