/**
 * glossaryRanker ユニットテスト (#326)
 * メッセージ履歴の言及頻度で organon vocab をランクし、relevance順 hot-core glossary を作る。
 * 今日の実測則の実装: 頻度降順=hot先頭 / hard entity のみ reading / document frequency で短語ノイズ抑制。
 * 純粋関数・DB 非依存。
 */
import * as mod from '../../src/services/glossaryRanker.mts';

const VOCAB = [
  { term: 'JU愛知', category: 'organization', aliases: ['JU愛知会場'] },
  { term: '畦塗機', category: 'product', aliases: ['あぜぬりき'], reading: 'あぜぬりき' },
  { term: 'ガマ', category: 'person', aliases: ['ガマさん', '蒲喜美雄'] },
  { term: 'クボタ', category: 'organization', aliases: [] },
  { term: '中', category: 'person', aliases: [] },
];

describe('役職 alias 汚染の除外', () => {
  // 甲野太郎 は person だが alias に汎用役職「社長/専務」を持つ。役職言及で person を
  // 頻度に引き込むと glossary が汚染される (2026-07-03 実データで 甲野太郎 が過剰 hot 化)。
  const VOCAB_ROLE = [
    { term: '甲野太郎', category: 'person', aliases: ['社長', '専務', '甲野専務'] },
    { term: 'ガマ', category: 'person', aliases: ['ガマさん'] },
  ];

  test('汎用役職 alias (社長/専務) 単独の言及は person にカウントしない', () => {
    const r = mod.rankByFrequency(VOCAB_ROLE, ['社長取れますか', '専務お願いします']);
    expect(r.find(x => x.term === '甲野太郎')!.count).toBe(0);
  });

  test('term 本体は従来どおりカウントする', () => {
    const r = mod.rankByFrequency(VOCAB_ROLE, ['甲野太郎さん来た']);
    expect(r.find(x => x.term === '甲野太郎')!.count).toBe(1);
  });

  test('名前付き役職 alias (甲野専務) は汎用役職ではないので残す', () => {
    const r = mod.rankByFrequency(VOCAB_ROLE, ['甲野専務が来た']);
    expect(r.find(x => x.term === '甲野太郎')!.count).toBe(1);
  });

  test('roleAliases を options で上書きできる', () => {
    const V = [{ term: '甲野太郎', category: 'person', aliases: ['親方'] }];
    // 「親方」を役職扱いに指定 → alias 経由の言及は除外、term は text に無いので 0
    const r = mod.rankByFrequency(V, ['親方お願いします'], { roleAliases: ['親方'] });
    expect(r.find(x => x.term === '甲野太郎')!.count).toBe(0);
  });
});

describe('rankByFrequency', () => {
  test('言及メッセージ数(document frequency)でカウントし降順に並べる', () => {
    const texts = ['JU愛知に納品', 'JU愛知の会場', 'ガマさん取れますか', 'クボタの機械'];
    const r = mod.rankByFrequency(VOCAB, texts);
    const byTerm = Object.fromEntries(r.map(x => [x.term, x.count]));
    expect(byTerm['JU愛知']).toBe(2);
    expect(byTerm['ガマ']).toBe(1);
    expect(byTerm['クボタ']).toBe(1);
    expect(byTerm['畦塗機']).toBe(0);
    expect(r[0].term).toBe('JU愛知');
  });

  test('alias 言及も本体 term にカウントする', () => {
    const r = mod.rankByFrequency(VOCAB, ['蒲喜美雄さんが来た', 'ガマさんも来た']);
    expect(r.find(x => x.term === 'ガマ')!.count).toBe(2);
  });

  test('同一メッセージ内の複数出現は 1 とする(document frequency)', () => {
    const r = mod.rankByFrequency(VOCAB, ['クボタとクボタとクボタ']);
    expect(r.find(x => x.term === 'クボタ')!.count).toBe(1);
  });

  test('同数は元の vocab 順で安定ソート', () => {
    const r = mod.rankByFrequency(VOCAB, []);
    expect(r.map(x => x.term)).toEqual(['JU愛知', '畦塗機', 'ガマ', 'クボタ', '中']);
  });
});

describe('buildHotGlossary', () => {
  const texts = ['JU愛知に納品', 'JU愛知の件', 'ガマさん', '畦塗機を運ぶ', 'クボタ'];

  test('頻度降順(hot先頭)で連結し、0言及は除外する', () => {
    const g = mod.buildHotGlossary(VOCAB, texts, { limit: 40 });
    expect(g).not.toContain('中');
    expect(g.startsWith('JU愛知')).toBe(true);
  });

  test('reading フィールドがある語のみ term（reading）で読み併記', () => {
    const g = mod.buildHotGlossary(VOCAB, texts, { limit: 40 });
    expect(g).toContain('畦塗機（あぜぬりき）');
    expect(g).toContain('クボタ');
    expect(g).not.toContain('ガマ（');
  });

  test('limit で hot-core サイズを上限する', () => {
    const g = mod.buildHotGlossary(VOCAB, texts, { limit: 2 });
    const terms = g.split('、');
    expect(terms.length).toBe(2);
    expect(terms[0].startsWith('JU愛知')).toBe(true);
  });

  test('言及ゼロ(履歴なし)なら空文字', () => {
    expect(mod.buildHotGlossary(VOCAB, [], { limit: 40 })).toBe('');
  });

  test('includeZero=true なら 0 言及も limit まで含める(fallback用)', () => {
    const g = mod.buildHotGlossary(VOCAB, [], { limit: 3, includeZero: true });
    expect(g.split('、').length).toBe(3);
  });
});
