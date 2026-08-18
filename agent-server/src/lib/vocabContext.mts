/**
 * Vocab Context — STT vocab を agent prompt に inject (人名・メーカー名・業務語の正規化)
 *
 * #348 (b): 供給源を legacy JSON から本体発行の local.ttl に切替。
 *   - primary: local.ttl (org1: RDF、server の refreshVocabFromTable が発行 = #348 (a))。
 *     辞書テーブル (organon pull + manual + auto をマージ済) 由来なので organon-transparent。
 *     organon を deploy しなくても manual+auto で local.ttl が埋まり、正規化が生き続ける。
 *   - fallback: legacy transcription_guideline.json (最後の砦)。local.ttl 未生成の環境でも
 *     旧挙動で動く defense in depth。
 *   出力 (別名→正規名 block) は term+alias のみ使用で従来と等価 (reading/description は
 *   parser が拾うが今は prompt に出さない = 将来 enrichment の芽だけ残す)。
 *
 * 元々の課題 (据置): organon 由来の業務語彙辞書は STT には効くが vision(OCR/帳票)には効かない
 * (vision は transcription_guideline を参照しないため)。この vocab を agent prompt に inject し、
 * OCR/文章読みでも同じ辞書で表記揺れを正規化できるようにする。
 *
 * env:
 *   - VOCAB_INJECT: 'true' で inject 有効化 (= opt-in、default OFF)。自社 deployment は .env で ON。
 *   - LOCAL_TTL_PATH: local.ttl の path override (= default は server/config/、#348 (a) の発行先と対)
 *   - VOCAB_GUIDELINE_PATH: legacy JSON fallback の path override (= default は server/config/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { Parser } from 'n3';
import { logger } from './logger.mts';

/** #348 (a) の発行先と対にする local.ttl path (env override 可) */
export const DEFAULT_LOCAL_TTL_FILE = process.env.LOCAL_TTL_PATH
  || path.resolve(import.meta.dirname, '../../../server/config/dictionary.local.ttl');

/** legacy JSON fallback (最後の砦) */
export const DEFAULT_VOCAB_FILE = process.env.VOCAB_GUIDELINE_PATH
  || path.resolve(import.meta.dirname, '../../../server/config/transcription_guideline.json');

// local.ttl の RDF 語彙 (server 側 dictionaryTtl.mts と同じ契約 URI)
const ORG_NS = 'https://tealus.local/organon/';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

export interface VocabEntry {
  term: string;
  category?: string;
  aliases: string[];
  reading?: string;
  description?: string;
}

/**
 * vocab inject が opt-in されているか (= VOCAB_INJECT==='true'、default OFF)
 */
export function isInjectEnabled(): boolean {
  return process.env.VOCAB_INJECT === 'true';
}

/**
 * #348 (b): local.ttl (org1: RDF) を parse して VocabEntry[] を返す (5 field 対応)。
 * file 不在 / parse 失敗は 空配列 (throw しない = fallback に流す)。
 */
export function loadVocabEntriesFromTtl(filePath: string = DEFAULT_LOCAL_TTL_FILE): VocabEntry[] {
  let ttl: string;
  try {
    ttl = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code !== 'ENOENT') {
      logger.warn(`[vocabContext] local.ttl read failed: ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return [];
  }
  try {
    const quads = new Parser().parse(ttl);
    const bySubject = new Map<string, VocabEntry>();
    const acc = (s: string): VocabEntry => {
      let a = bySubject.get(s);
      if (!a) { a = { term: '', aliases: [] }; bySubject.set(s, a); }
      return a;
    };
    for (const q of quads) {
      const s = q.subject.value;
      const p = q.predicate.value;
      const o = q.object.value;
      if (p === RDFS_LABEL) acc(s).term = o;
      else if (p === `${ORG_NS}category`) acc(s).category = o;
      else if (p === `${ORG_NS}reading`) acc(s).reading = o;
      else if (p === `${ORG_NS}description`) acc(s).description = o;
      else if (p === `${ORG_NS}alias`) acc(s).aliases.push(o);
    }
    return [...bySubject.values()].filter((e) => e.term);
  } catch (e) {
    logger.warn(`[vocabContext] local.ttl parse failed: ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * legacy transcription_guideline.json の vocabulary 配列を読む (= fallback)
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
 * #348 (b): primary=local.ttl → fallback=legacy JSON の順で vocab を解決する。
 * local.ttl が 1 件でも取れればそれを使い、空/不在なら JSON にフォールバック。
 */
function resolveVocab(options: { ttlPath?: string; filePath?: string } = {}): VocabEntry[] {
  const fromTtl = loadVocabEntriesFromTtl(options.ttlPath || DEFAULT_LOCAL_TTL_FILE);
  if (fromTtl.length) return fromTtl;
  return loadVocabEntries(options.filePath || DEFAULT_VOCAB_FILE);
}

/**
 * vocab を「正規名 ← 別名, 別名…」の正規化 block に整形 (= aliases を持つ entry のみ)
 *
 * - VOCAB_INJECT!=='true' (= default) → 空文字
 * - local.ttl / JSON いずれも空 / aliases 持つ entry 0 件 → 空文字 (silent skip)
 *
 * @returns prompt に concat する text (= 空文字 or 整形済 block)
 */
export function loadVocabForPrompt(options: { ttlPath?: string; filePath?: string } = {}): string {
  if (!isInjectEnabled()) return '';

  const lines = resolveVocab(options)
    .filter((e) => e && e.term && Array.isArray(e.aliases) && e.aliases.length > 0)
    .map((e) => `- ${e.term} ← ${e.aliases.join(', ')}`);
  if (lines.length === 0) return '';

  return [
    '',
    '## 業務語彙の正規化 (= 別名 → 正規名)',
    '',
    '以下は社内で確定済みの表記対応です (人名・メーカー名・業務語)。'
      + '**音声の文字起こし・議事録・画像や帳票の読み取り**のいずれであっても、'
      + '生成する文章に別名と一致する語が現れたら、**正規名に置換**してください。',
    '元の表記を併記して残す必要はありません。'
      + '表に無い語は勝手に近い語へ寄せず、そのまま扱ってください。',
    '',
    ...lines,
    '',
  ].join('\n');
}

/**
 * 起動時に vocab inject の ON/OFF を 1 行ログ (= organon と同型、検証可能化)
 */
export function logVocabInjectState(options: { ttlPath?: string; filePath?: string } = {}): void {
  if (!isInjectEnabled()) {
    logger.info('[vocabContext] vocab inject: OFF (set VOCAB_INJECT=true to enable)');
    return;
  }
  const terms = resolveVocab(options)
    .filter((e) => e && e.term && Array.isArray(e.aliases) && e.aliases.length > 0).length;
  logger.info(`[vocabContext] vocab inject: ON (terms=${terms})`);
}
