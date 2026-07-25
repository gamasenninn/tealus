/**
 * #348 (a): 本体辞書テーブル → local.ttl serializer の unit test。
 *
 * scope: VocabularyEntry[] (= refreshVocabFromTable が作る overlay 行、5 field) を
 * organon.ttl と同じ org1: RDF 語彙の Turtle に serialize する純関数 + file 書き出し。
 * - 5 field 全部を載せる (term/alias/reading/category/description)。term+alias だけに
 *   痩せさせない (= #348 設計要件: buildGlossary の reading / OrganonCorrection の
 *   reading+description が落ちる事故を防ぐ)。
 * - 手書き出力の Turtle 準拠性は n3 Parser の round-trip で担保する。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Parser } from 'n3';
import {
  serializeVocabToTtl,
  writeLocalTtl,
  ORG_NS,
} from '../../src/services/dictionaryTtl.mts';

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

/** ttl を parse して {label, category, reading, description, aliases[]} を subject 単位で束ねる */
function parseBack(ttl: string): Array<{ label: string; category?: string; reading?: string; description?: string; aliases: string[] }> {
  const quads = new Parser().parse(ttl);
  const bySubject = new Map<string, { label: string; category?: string; reading?: string; description?: string; aliases: string[] }>();
  const acc = (s: string) => {
    let a = bySubject.get(s);
    if (!a) { a = { label: '', aliases: [] }; bySubject.set(s, a); }
    return a;
  };
  for (const q of quads) {
    const s = q.subject.value;
    const p = q.predicate.value;
    const o = q.object.value;
    if (p === RDFS_LABEL) acc(s).label = o;
    else if (p === `${ORG_NS}category`) acc(s).category = o;
    else if (p === `${ORG_NS}reading`) acc(s).reading = o;
    else if (p === `${ORG_NS}description`) acc(s).description = o;
    else if (p === `${ORG_NS}alias`) acc(s).aliases.push(o);
  }
  return [...bySubject.values()];
}

describe('serializeVocabToTtl', () => {
  test('空配列 → prefix だけの valid Turtle (subject 0 件)', () => {
    const ttl = serializeVocabToTtl([]);
    expect(() => new Parser().parse(ttl)).not.toThrow();
    expect(parseBack(ttl)).toHaveLength(0);
    // prefix 宣言は残す (consumer が @prefix 前提でも壊れない)
    expect(ttl).toContain('@prefix org1:');
  });

  test('5 field 全部を載せる (term/alias/reading/category/description)', () => {
    const ttl = serializeVocabToTtl([
      { term: '山崎', category: 'person', reading: 'やまざき', description: '整備長', aliases: ['まさ', 'マサ'] },
    ]);
    const parsed = parseBack(ttl);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      label: '山崎',
      category: 'person',
      reading: 'やまざき',
      description: '整備長',
    });
    expect(parsed[0].aliases.sort()).toEqual(['まさ', 'マサ'].sort());
  });

  test('reading / description / aliases が無い entry は該当述語を出さない (label + category のみ)', () => {
    const ttl = serializeVocabToTtl([
      { term: '売上', category: 'term', reading: null, description: null, aliases: [] },
    ]);
    expect(ttl).not.toContain('org1:reading');
    expect(ttl).not.toContain('org1:description');
    expect(ttl).not.toContain('org1:alias');
    const parsed = parseBack(ttl);
    expect(parsed[0]).toMatchObject({ label: '売上', category: 'term' });
    expect(parsed[0].aliases).toEqual([]);
    expect(parsed[0].reading).toBeUndefined();
    expect(parsed[0].description).toBeUndefined();
  });

  test('literal のエスケープ: " や \\ や 改行 を含む description が round-trip する', () => {
    const nasty = 'A "B" \\C\n次行';
    const ttl = serializeVocabToTtl([
      { term: '試験', category: 'term', reading: null, description: nasty, aliases: ['a"b'] },
    ]);
    expect(() => new Parser().parse(ttl)).not.toThrow();
    const parsed = parseBack(ttl);
    expect(parsed[0].description).toBe(nasty);
    expect(parsed[0].aliases).toEqual(['a"b']);
  });

  test('決定論: 入力順が違っても出力は同一 (term でソート)', () => {
    const a = serializeVocabToTtl([
      { term: '田中', category: 'person', aliases: [] },
      { term: '安藤', category: 'person', aliases: [] },
    ]);
    const b = serializeVocabToTtl([
      { term: '安藤', category: 'person', aliases: [] },
      { term: '田中', category: 'person', aliases: [] },
    ]);
    expect(a).toBe(b);
  });

  test('term が空/空白の entry は skip', () => {
    const ttl = serializeVocabToTtl([
      { term: '', category: 'person', aliases: ['x'] },
      { term: '  ', category: 'person', aliases: ['y'] },
      { term: '本物', category: 'person', aliases: [] },
    ]);
    const parsed = parseBack(ttl);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe('本物');
  });
});

describe('writeLocalTtl', () => {
  test('serialize 結果を file に書き出し、読み戻して parse できる', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dict-ttl-test-'));
    const out = path.join(tmpDir, 'nested', 'dictionary.local.ttl');
    try {
      await writeLocalTtl(out, [
        { term: '山崎', category: 'person', reading: 'やまざき', description: '整備長', aliases: ['まさ'] },
      ]);
      expect(fs.existsSync(out)).toBe(true); // 中間ディレクトリも作る
      const back = parseBack(fs.readFileSync(out, 'utf8'));
      expect(back[0]).toMatchObject({ label: '山崎', reading: 'やまざき' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
