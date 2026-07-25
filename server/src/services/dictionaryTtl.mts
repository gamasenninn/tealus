/**
 * #348 (a): 本体辞書テーブル → local.ttl serializer。
 *
 * refreshVocabFromTable が作る overlay 行 (VocabularyEntry、5 field) を organon.ttl と同じ
 * `org1:` RDF 語彙の Turtle に serialize し、file に書き出す。agent-server (別プロセス) は
 * この local.ttl を file 読みして vocab 正規化に使う (#348 (b))。
 *
 * 設計要件 (#348):
 *   - 5 field 全部を載せる (term/alias/reading/category/description)。term+alias だけに
 *     痩せさせない (= buildGlossary の reading / OrganonCorrection の reading+description が
 *     落ちる事故を防ぐ)。将来 agent が reading/description を使う enrichment を塞がない。
 *   - organon.ttl は reading/category/description 述語を持たないので、本体所有の述語として
 *     org1:reading / org1:category / org1:description を定義する (本体 local.ttl なので OK)。
 *   - term/alias は organon と同じ rdfs:label / org1:alias を使う (= 1 個の parser で両方読める)。
 *   - 決定論的出力 (term でソート): 同一内容なら byte 一致 = git / mtime の無駄 churn を避ける。
 *
 * 手書き出力の Turtle 準拠性は round-trip (n3 Parser) テストで担保している。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { VocabularyEntry } from './transcriptionConfig.mts';

/** organon.ttl と共有する RDF 名前空間 (organonDictProjection.mts の ORG と同一) */
export const ORG_NS = 'https://tealus.local/organon/';
/** local dict の subject IRI 前置 (term を percent-encode して IRI 化) */
export const DICT_NS = 'https://tealus.local/dict/';
const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';

/** Turtle string literal のエスケープ ("..." 内。\ " と制御文字) */
function ttlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * VocabularyEntry[] を org1: 語彙の Turtle 文字列に serialize する (純関数・決定論)。
 * term が空/空白の entry は skip。term でソートして出力を安定化する。
 */
export function serializeVocabToTtl(entries: VocabularyEntry[]): string {
  const rows = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.term === 'string' && e.term.trim())
    .map((e) => ({
      term: e.term.trim(),
      category: e.category && String(e.category).trim() ? String(e.category).trim() : null,
      reading: e.reading && String(e.reading).trim() ? String(e.reading).trim() : null,
      description: e.description && String(e.description).trim() ? String(e.description).trim() : null,
      aliases: Array.isArray(e.aliases)
        ? [...new Set(e.aliases.map((a) => (typeof a === 'string' ? a.trim() : '')).filter(Boolean))].sort()
        : [],
    }))
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));

  const header = [
    `@prefix rdfs: <${RDFS_NS}> .`,
    `@prefix org1: <${ORG_NS}> .`,
    '',
    '# 本体辞書テーブル由来の local vocab 契約 (#348)。自動生成 — 手で編集しない。',
    '',
  ];

  const blocks: string[] = [];
  for (const r of rows) {
    const subject = `<${DICT_NS}${encodeURIComponent(r.term)}>`;
    const preds: string[] = [`rdfs:label ${ttlString(r.term)}`];
    if (r.category) preds.push(`org1:category ${ttlString(r.category)}`);
    if (r.reading) preds.push(`org1:reading ${ttlString(r.reading)}`);
    if (r.aliases.length) preds.push(`org1:alias ${r.aliases.map(ttlString).join(', ')}`);
    if (r.description) preds.push(`org1:description ${ttlString(r.description)}`);
    blocks.push(`${subject}\n  ${preds.join(' ;\n  ')} .`);
  }

  return `${header.join('\n')}${blocks.join('\n\n')}${blocks.length ? '\n' : ''}`;
}

/**
 * serializeVocabToTtl の結果を file に書き出す (中間ディレクトリも作る)。
 * 呼び出し側 (refreshVocabFromTable) は非致命で扱う想定 (書き込み失敗で refresh を壊さない)。
 */
export async function writeLocalTtl(filePath: string, entries: VocabularyEntry[]): Promise<void> {
  const ttl = serializeVocabToTtl(entries);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, ttl, 'utf8');
}

/** local.ttl の既定 path (env override 可)。agent-server 側の読み取り path と対にする。 */
export const DEFAULT_LOCAL_TTL_PATH = process.env.LOCAL_TTL_PATH
  || path.join(import.meta.dirname, '../../config/dictionary.local.ttl');

/** DEFAULT_LOCAL_TTL_PATH の親ディレクトリが存在するか (書き出し先の健全性 check 用) */
export function localTtlDirExists(): boolean {
  try {
    return fs.existsSync(path.dirname(DEFAULT_LOCAL_TTL_PATH));
  } catch {
    return false;
  }
}
