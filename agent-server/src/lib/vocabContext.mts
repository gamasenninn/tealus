/**
 * Vocab Context — STT vocab (transcription_guideline.json) を agent prompt に inject
 *
 * 課題: organon 由来の業務語彙辞書 (= 別名 → 正規名) は STT (Whisper 文字起こし) には
 * 効くが、画像 OCR / 帳票読み取り (= vision) には全く効かない。vision は get_message_media
 * → LLM が読むだけで、transcription_guideline.json を参照しないため (= server 側 STT 専用)。
 *
 * 解: STT vocab の `vocabulary` (= 151 entry の term + aliases) を agent prompt にも inject し、
 * OCR / 文章読みで読み取った人名・メーカー名・業務語の表記揺れを同じ辞書で正規化できるようにする。
 * organonContext (= polyseme.sql_mapping inject) の vocab 版。
 *
 * env:
 *   - VOCAB_INJECT: 'true' で inject 有効化 (= opt-in、default OFF)。自社 deployment は .env で ON。
 *   - VOCAB_GUIDELINE_PATH: transcription_guideline.json の path override (= default は server/config/)
 *
 * 関連:
 *   - organonContext.js (= polyseme.sql_mapping inject、同型 pattern)
 *   - server/config/transcription_guideline.json (= organon-daily が更新する STT vocab)
 *   - 出品票 OCR dogfood (= 6/22 再出品業務ルーム、vision で organon が効かない件)
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.mts';

export const DEFAULT_VOCAB_FILE = process.env.VOCAB_GUIDELINE_PATH
  || path.resolve(import.meta.dirname, '../../../server/config/transcription_guideline.json');

export interface VocabEntry {
  term: string;
  category?: string;
  aliases: string[];
}

/**
 * vocab inject が opt-in されているか (= VOCAB_INJECT==='true'、default OFF)
 */
export function isInjectEnabled(): boolean {
  return process.env.VOCAB_INJECT === 'true';
}

/**
 * transcription_guideline.json の vocabulary 配列を読む (= [{term, category, aliases}])
 */
export function loadVocabEntries(filePath: string = DEFAULT_VOCAB_FILE): VocabEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { vocabulary?: unknown };
    return Array.isArray(raw.vocabulary) ? (raw.vocabulary as VocabEntry[]) : [];
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined;
    const message = e instanceof Error ? e.message : String(e);
    if (code !== 'ENOENT') logger.warn(`[vocabContext] read failed: ${filePath}: ${message}`);
    return [];
  }
}

/**
 * vocab を「正規名 ← 別名, 別名…」の正規化 block に整形 (= aliases を持つ entry のみ)
 *
 * - VOCAB_INJECT!=='true' (= default) → 空文字
 * - file 不在 / vocabulary 0 件 / aliases 持つ entry 0 件 → 空文字 (silent skip)
 *
 * @returns prompt に concat する text (= 空文字 or 整形済 block)
 */
export function loadVocabForPrompt(options: { filePath?: string } = {}): string {
  if (!isInjectEnabled()) return '';

  const filePath = options.filePath || DEFAULT_VOCAB_FILE;
  const lines = loadVocabEntries(filePath)
    .filter((e) => e && e.term && Array.isArray(e.aliases) && e.aliases.length > 0)
    .map((e) => `- ${e.term} ← ${e.aliases.join(', ')}`);
  if (lines.length === 0) return '';

  return [
    '',
    '## 業務語彙の正規化 (= 別名 → 正規名)',
    '',
    '画像・帳票・文章から読み取った語が以下の別名に該当する場合は、正規名に正規化してください'
      + ' (人名・メーカー名・業務語の表記揺れ対応)。該当しない語はそのまま扱ってください。',
    '',
    ...lines,
    '',
  ].join('\n');
}

/**
 * 起動時に vocab inject の ON/OFF を 1 行ログ (= organon と同型、検証可能化)
 */
export function logVocabInjectState(options: { filePath?: string } = {}): void {
  if (!isInjectEnabled()) {
    logger.info('[vocabContext] vocab inject: OFF (set VOCAB_INJECT=true to enable)');
    return;
  }
  const filePath = options.filePath || DEFAULT_VOCAB_FILE;
  const terms = loadVocabEntries(filePath)
    .filter((e) => e && e.term && Array.isArray(e.aliases) && e.aliases.length > 0).length;
  logger.info(`[vocabContext] vocab inject: ON (terms=${terms}, path=${filePath})`);
}
