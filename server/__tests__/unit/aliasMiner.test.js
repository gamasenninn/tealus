/**
 * aliasMiner ユニットテスト
 * voice_transcriptions 編集履歴 → alias 候補抽出のロジック
 * GPT 部分はモックして API 呼び出し無しでテスト
 */
const aliasMiner = require('../../src/services/aliasMiner');

describe('buildPairsFromRows', () => {
  test('extracts pair from AI v1 + user v2', () => {
    const rows = [
      { message_id: 'm1', version: 1, formatted_text: 'カナさん撮れますか？', edited_by: null },
      { message_id: 'm1', version: 2, formatted_text: 'ガマさん撮れますか？', edited_by: 'u1' },
    ];
    const pairs = aliasMiner.buildPairsFromRows(rows);
    expect(pairs).toEqual([
      { messageId: 'm1', aiText: 'カナさん撮れますか？', userText: 'ガマさん撮れますか？' },
    ]);
  });

  test('skips message with only AI version', () => {
    const rows = [{ message_id: 'm1', version: 1, formatted_text: 'A', edited_by: null }];
    expect(aliasMiner.buildPairsFromRows(rows)).toEqual([]);
  });

  test('skips message with only user edit (no AI baseline)', () => {
    const rows = [{ message_id: 'm1', version: 2, formatted_text: 'A', edited_by: 'u1' }];
    expect(aliasMiner.buildPairsFromRows(rows)).toEqual([]);
  });

  test('uses latest user edit when multiple edits exist', () => {
    const rows = [
      { message_id: 'm1', version: 1, formatted_text: 'AI', edited_by: null },
      { message_id: 'm1', version: 2, formatted_text: 'edit1', edited_by: 'u1' },
      { message_id: 'm1', version: 3, formatted_text: 'edit2', edited_by: 'u2' },
    ];
    const pairs = aliasMiner.buildPairsFromRows(rows);
    expect(pairs[0].userText).toBe('edit2');
  });

  test('skips when AI and user texts are identical', () => {
    const rows = [
      { message_id: 'm1', version: 1, formatted_text: 'same', edited_by: null },
      { message_id: 'm1', version: 2, formatted_text: 'same', edited_by: 'u1' },
    ];
    expect(aliasMiner.buildPairsFromRows(rows)).toEqual([]);
  });

  test('skips when formatted_text is missing/null', () => {
    const rows = [
      { message_id: 'm1', version: 1, formatted_text: null, edited_by: null },
      { message_id: 'm1', version: 2, formatted_text: 'edit', edited_by: 'u1' },
    ];
    expect(aliasMiner.buildPairsFromRows(rows)).toEqual([]);
  });

  test('handles multiple messages independently', () => {
    const rows = [
      { message_id: 'm1', version: 1, formatted_text: 'A', edited_by: null },
      { message_id: 'm1', version: 2, formatted_text: 'A-fixed', edited_by: 'u1' },
      { message_id: 'm2', version: 1, formatted_text: 'B', edited_by: null },
      { message_id: 'm2', version: 2, formatted_text: 'B-fixed', edited_by: 'u1' },
    ];
    const pairs = aliasMiner.buildPairsFromRows(rows);
    expect(pairs).toHaveLength(2);
  });
});

describe('extractAliases', () => {
  function makeOpenAI(responseText) {
    return {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: responseText } }],
          }),
        },
      },
    };
  }

  test('parses JSON array response', async () => {
    const openai = makeOpenAI('[{"from":"カナ","to":"ガマ","category":"person","confidence":"high"}]');
    const result = await aliasMiner.extractAliases(
      { aiText: 'カナさん', userText: 'ガマさん' },
      openai
    );
    expect(result).toEqual([
      { from: 'カナ', to: 'ガマ', category: 'person', confidence: 'high' },
    ]);
  });

  test('strips markdown code fences from response', async () => {
    const openai = makeOpenAI('```json\n[{"from":"A","to":"B"}]\n```');
    const result = await aliasMiner.extractAliases({ aiText: 'a', userText: 'b' }, openai);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('A');
  });

  test('returns [] on JSON parse error', async () => {
    const openai = makeOpenAI('not valid json at all');
    const result = await aliasMiner.extractAliases({ aiText: 'a', userText: 'b' }, openai);
    expect(result).toEqual([]);
  });

  test('returns [] on empty array response', async () => {
    const openai = makeOpenAI('[]');
    const result = await aliasMiner.extractAliases({ aiText: 'a', userText: 'b' }, openai);
    expect(result).toEqual([]);
  });

  test('returns [] when API call throws', async () => {
    const openai = {
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(new Error('API down')),
        },
      },
    };
    const result = await aliasMiner.extractAliases({ aiText: 'a', userText: 'b' }, openai);
    expect(result).toEqual([]);
  });

  test('filters entries where from equals to', async () => {
    const openai = makeOpenAI('[{"from":"X","to":"X"},{"from":"A","to":"B"}]');
    const result = await aliasMiner.extractAliases({ aiText: 'a', userText: 'b' }, openai);
    expect(result).toEqual([{ from: 'A', to: 'B' }]);
  });

  test('filters entries with empty strings', async () => {
    const openai = makeOpenAI('[{"from":"","to":"X"},{"from":"A","to":""}]');
    const result = await aliasMiner.extractAliases({ aiText: 'a', userText: 'b' }, openai);
    expect(result).toEqual([]);
  });

  test('returns [] when response is not an array', async () => {
    const openai = makeOpenAI('{"from":"A","to":"B"}');
    const result = await aliasMiner.extractAliases({ aiText: 'a', userText: 'b' }, openai);
    expect(result).toEqual([]);
  });
});

describe('aggregateAliases (pair mode, default)', () => {
  test('drops aliases below threshold', () => {
    const aliases = [{ from: 'a', to: 'b', category: 'person', confidence: 'high' }];
    expect(aliasMiner.aggregateAliases(aliases, 2)).toEqual([]);
  });

  test('counts repeated aliases', () => {
    const aliases = [
      { from: 'a', to: 'b', category: 'person', confidence: 'high' },
      { from: 'a', to: 'b', category: 'person', confidence: 'medium' },
      { from: 'a', to: 'b', category: 'person', confidence: 'high' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, 2);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
    expect(result[0].confidences).toEqual({ high: 2, medium: 1, low: 0 });
  });

  test('resolves category by majority vote', () => {
    const aliases = [
      { from: 'a', to: 'b', category: 'person' },
      { from: 'a', to: 'b', category: 'place' },
      { from: 'a', to: 'b', category: 'person' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, 1);
    expect(result[0].category).toBe('person');
  });

  test('sorts results by count descending', () => {
    const aliases = [
      { from: 'x', to: 'y' },
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, 1);
    expect(result[0].from).toBe('a');
    expect(result[0].count).toBe(3);
    expect(result[1].count).toBe(1);
  });

  test('handles missing category and confidence with defaults', () => {
    const aliases = [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }];
    const result = aliasMiner.aggregateAliases(aliases, 1);
    expect(result[0].category).toBe('term');
    expect(result[0].confidences).toEqual({ high: 0, medium: 2, low: 0 });
  });

  test('legacy number threshold argument is supported (backwards compatibility)', () => {
    const aliases = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, 2);
    expect(result).toHaveLength(1);
  });

  test('options object form works equivalently', () => {
    const aliases = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, { threshold: 2 });
    expect(result).toHaveLength(1);
  });
});

describe('aggregateAliases (by-term mode, #208)', () => {
  test('aggregates by `to` and includes long-tail variants under threshold', () => {
    // ガマ系: 4 通りの誤認 1 件ずつ (個別 pair は閾値未満だが term 単位で 4)
    const aliases = [
      { from: '河川くん', to: 'ガマくん', category: 'person', confidence: 'medium' },
      { from: 'ごまちゃん', to: 'ガマちゃん', category: 'person', confidence: 'medium' },
      { from: '今', to: 'ガマ', category: 'person', confidence: 'medium' },
      { from: '岡本', to: 'ガマ', category: 'person', confidence: 'medium' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, { mode: 'by-term', threshold: 2 });
    // 4 つの to 値: ガマくん / ガマちゃん / ガマ / ガマ
    // by-term 集約: ガマくん=1, ガマちゃん=1, ガマ=2 → threshold=2 では ガマ のみ採用 (2 件)
    const tos = result.map(r => r.to);
    expect(tos).toEqual(['ガマ', 'ガマ']); // 「今」「岡本」の 2 件
    expect(result).toHaveLength(2);
  });

  test('high threshold drops all when no term reaches it', () => {
    const aliases = [
      { from: 'a1', to: 'X' },
      { from: 'a2', to: 'X' },
      { from: 'a3', to: 'Y' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, { mode: 'by-term', threshold: 5 });
    expect(result).toEqual([]);
  });

  test('low threshold (1) accepts all', () => {
    const aliases = [
      { from: 'a', to: 'X' },
      { from: 'b', to: 'Y' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, { mode: 'by-term', threshold: 1 });
    expect(result).toHaveLength(2);
  });

  test('requireHighConfidence drops terms with no high-confidence alias', () => {
    const aliases = [
      { from: 'a1', to: 'X', confidence: 'medium' },
      { from: 'a2', to: 'X', confidence: 'medium' },
      { from: 'b1', to: 'Y', confidence: 'high' },
      { from: 'b2', to: 'Y', confidence: 'medium' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, {
      mode: 'by-term',
      threshold: 2,
      requireHighConfidence: true,
    });
    // X は high 0 で除外、Y は high 1 で採用
    const tos = [...new Set(result.map(r => r.to))];
    expect(tos).toEqual(['Y']);
    expect(result).toHaveLength(2);
  });

  test('by-term mode preserves pair-level count and confidences in output', () => {
    const aliases = [
      { from: '岡本', to: 'ガマ', confidence: 'high' },
      { from: '今', to: 'ガマ', confidence: 'medium' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, { mode: 'by-term', threshold: 2 });
    const okamoto = result.find(r => r.from === '岡本');
    const ima = result.find(r => r.from === '今');
    expect(okamoto.count).toBe(1);
    expect(ima.count).toBe(1);
    expect(okamoto.confidences.high).toBe(1);
    expect(ima.confidences.medium).toBe(1);
  });

  test('by-term mode does not affect entries with multiple pair-level occurrences', () => {
    const aliases = [
      { from: 'a', to: 'X' },
      { from: 'a', to: 'X' },
      { from: 'a', to: 'X' },
    ];
    const result = aliasMiner.aggregateAliases(aliases, { mode: 'by-term', threshold: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
  });
});

describe('buildMergeCandidates', () => {
  test('classifies new term when not in existing vocabulary', () => {
    const aggregated = [
      { from: 'カナ', to: 'ガマ', category: 'person', count: 3, confidences: {} },
    ];
    const result = aliasMiner.buildMergeCandidates(aggregated, []);
    expect(result.newTerms).toHaveLength(1);
    expect(result.newTerms[0].term).toBe('ガマ');
    expect(result.newTerms[0].aliases).toEqual(['カナ']);
    expect(result.newTerms[0].counts).toEqual({ カナ: 3 });
    expect(result.aliasAdditions).toEqual([]);
  });

  test('adds new alias to existing term', () => {
    const aggregated = [
      { from: 'カナ', to: 'ガマ', category: 'person', count: 3, confidences: {} },
    ];
    const existing = [{ term: 'ガマ', category: 'person', aliases: ['がま', 'ガマさん'] }];
    const result = aliasMiner.buildMergeCandidates(aggregated, existing);
    expect(result.newTerms).toEqual([]);
    expect(result.aliasAdditions).toHaveLength(1);
    expect(result.aliasAdditions[0].term).toBe('ガマ');
    expect(result.aliasAdditions[0].new_aliases).toEqual(['カナ']);
    expect(result.aliasAdditions[0].existingTerm).toBe(true);
    expect(result.aliasAdditions[0].existingCategory).toBe('person');
  });

  test('skips alias already in existing aliases', () => {
    const aggregated = [
      { from: 'カナ', to: 'ガマ', category: 'person', count: 3, confidences: {} },
    ];
    const existing = [{ term: 'ガマ', category: 'person', aliases: ['カナ', 'がま'] }];
    const result = aliasMiner.buildMergeCandidates(aggregated, existing);
    expect(result.newTerms).toEqual([]);
    expect(result.aliasAdditions).toEqual([]);
  });

  test('groups multiple aliases for same term', () => {
    const aggregated = [
      { from: 'カナ', to: 'ガマ', category: 'person', count: 3, confidences: {} },
      { from: 'がま', to: 'ガマ', category: 'person', count: 2, confidences: {} },
    ];
    const result = aliasMiner.buildMergeCandidates(aggregated, []);
    expect(result.newTerms).toHaveLength(1);
    expect(result.newTerms[0].aliases).toEqual(['カナ', 'がま']);
    expect(result.newTerms[0].counts).toEqual({ カナ: 3, がま: 2 });
  });

  test('handles empty aggregated input', () => {
    const result = aliasMiner.buildMergeCandidates([], []);
    expect(result.newTerms).toEqual([]);
    expect(result.aliasAdditions).toEqual([]);
  });

  test('treats vocabulary entry without aliases as empty', () => {
    const aggregated = [
      { from: 'カナ', to: 'ガマ', category: 'person', count: 2, confidences: {} },
    ];
    const existing = [{ term: 'ガマ', category: 'person' }];
    const result = aliasMiner.buildMergeCandidates(aggregated, existing);
    expect(result.aliasAdditions).toHaveLength(1);
    expect(result.aliasAdditions[0].new_aliases).toEqual(['カナ']);
  });
});

// #327 Phase1 安全ゲート: 音韻近接 + コーパス精度 で「変換して壊れない」garble→term だけ通す
describe('extractAliasPairs (#327 決定論 char-LCS 抽出、LLM不要)', () => {
  test('崩れ→既知term を抽出 (ホタカ→保坂)', () => {
    const r = aliasMiner.extractAliasPairs('ホタカさん取れますか', '保坂さん取れますか', ['保坂']);
    expect(r).toEqual([{ from: 'ホタカ', to: '保坂' }]);
  });

  test('話者名の前置 (削除なしの挿入) は無視する', () => {
    // 人間が「ガマ」を頭に足しただけ = garbleを置換していない
    const r = aliasMiner.extractAliasPairs('休憩戻りました', 'ガマ休憩戻りました', ['ガマ']);
    expect(r).toEqual([]);
  });

  test('全文書き換え (変更>50%) は棄却する', () => {
    const r = aliasMiner.extractAliasPairs(
      'AIの短い文', '田部井さんと下野新聞と黒瀬が全部違う長い別の内容に書き換わった文章です',
      ['田部井', '下野新聞', '黒瀬']);
    expect(r).toEqual([]);
  });

  test('挿入側に既知termが無ければ拾わない', () => {
    const r = aliasMiner.extractAliasPairs('あいうさん', 'かきくさん', ['保坂']);
    expect(r).toEqual([]);
  });

  test('AIと人間が同一なら空', () => {
    expect(aliasMiner.extractAliasPairs('同じ', '同じ', ['保坂'])).toEqual([]);
  });

  test('複数の置換を抽出する', () => {
    const r = aliasMiner.extractAliasPairs(
      'サビーが岡崎に戻る。フェビト取れますか',
      '田部井が岡崎に戻る。整備長取れますか',
      ['田部井', '整備長']);
    expect(r).toEqual(expect.arrayContaining([
      { from: 'サビー', to: '田部井' },
      { from: 'フェビト', to: '整備長' },
    ]));
  });

  test('長すぎる削除(=文章)は garble として拾わない', () => {
    const r = aliasMiner.extractAliasPairs(
      'これはとても長い崩れた文章がここに入りますよねさん', '保坂さん', ['保坂'], { maxGarbleLen: 8 });
    expect(r).toEqual([]);
  });
});

describe('moraDistance (音韻近接ゲートの土台)', () => {
  test('同一読みは 0', () => {
    expect(aliasMiner.moraDistance('ほさか', 'ほさか')).toBe(0);
  });
  test('ほたか vs ほさか は ~0.33 (1モーラ差/3)', () => {
    expect(aliasMiner.moraDistance('ほたか', 'ほさか')).toBeCloseTo(1/3, 5);
  });
  test('どうも vs がま は遠い (>0.5)', () => {
    expect(aliasMiner.moraDistance('どうも', 'がま')).toBeGreaterThan(0.5);
  });
  test('カタカナ読みも内部で正規化して比較する', () => {
    expect(aliasMiner.moraDistance('ホサカ', 'ほさか')).toBe(0);
  });
  test('空文字は距離1 (無効)', () => {
    expect(aliasMiner.moraDistance('', 'ほさか')).toBe(1);
  });
});

describe('corpusPrecision (常用語ガードの土台)', () => {
  test('P = 修正回数 / 出現数', () => {
    expect(aliasMiner.corpusPrecision(7, 9)).toBeCloseTo(0.78, 2);
    expect(aliasMiner.corpusPrecision(1, 30)).toBeCloseTo(0.033, 3);
  });
  test('出現数 < 修正回数 でも 1 を超えない (guard)', () => {
    expect(aliasMiner.corpusPrecision(3, 1)).toBe(1);
    expect(aliasMiner.corpusPrecision(2, 0)).toBe(1);
  });
});

describe('filterSafeAliases (#327 Phase1: 2ゲート + 自動/確認分岐)', () => {
  // 依存注入: 読み・コーパス出現数はスタブ (DB非依存 = テスト可能)
  const READ = { 'ホタカ':'ほたか', '保坂':'ほさか', 'タベイソン':'たべいそん', '田部井':'たべい',
    'どうも':'どうも', 'ガマ':'がま', 'まさか':'まさか', '小川':'おがわ', '小川朱美':'おがわあけみ' };
  const OCC = { 'ホタカ':9, 'タベイソン':1, 'どうも':500, 'まさか':8, '小川':40 };
  const opts = { getReading: t => READ[t] || '', getOccurrence: g => OCC[g] || 1 };

  test('音韻近 + 高P + freq≥2 → 自動追加 (ホタカ→保坂)', () => {
    const r = aliasMiner.filterSafeAliases([{ from:'ホタカ', to:'保坂', count:7 }], opts);
    expect(r.auto).toHaveLength(1);
    expect(r.auto[0].from).toBe('ホタカ');
    expect(r.confirm).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  test('音韻近 + 高P + freq=1 → 人間確認 (タベイソン→田部井)', () => {
    const r = aliasMiner.filterSafeAliases([{ from:'タベイソン', to:'田部井', count:1 }], opts);
    expect(r.confirm).toHaveLength(1);
    expect(r.auto).toEqual([]);
  });

  test('音韻遠 → 棄却 reason=phonetic (どうも→ガマ)', () => {
    const r = aliasMiner.filterSafeAliases([{ from:'どうも', to:'ガマ', count:9 }], opts);
    expect(r.auto).toEqual([]);
    expect(r.confirm).toEqual([]);
    expect(r.rejected[0].reason).toBe('phonetic');
  });

  test('★低P (常用語) → 棄却 reason=common-word (まさか→保坂)', () => {
    // まさか(3字) vs ほさか は音韻的に近い(短別名・音韻ゲート通過)が、
    // コーパス精度 P=1/8 で棄却 = 常用語ガードが効く
    const r = aliasMiner.filterSafeAliases([{ from:'まさか', to:'保坂', count:1 }], opts);
    expect(r.auto).toEqual([]);
    expect(r.confirm).toEqual([]);
    expect(r.rejected[0].reason).toBe('common-word');
  });

  test('≤2字の裸の garble → 棄却 reason=short (小川→小川朱美)', () => {
    const r = aliasMiner.filterSafeAliases([{ from:'小川', to:'小川朱美', count:3 }], opts);
    expect(r.rejected[0].reason).toBe('short');
  });

  test('閾値はオプションで調整可能', () => {
    // autoFreq=3 なら freq=2 は confirm 行き (タベイソン=出現1でPは通る)
    const r = aliasMiner.filterSafeAliases([{ from:'タベイソン', to:'田部井', count:2 }], { ...opts, autoFreq:3 });
    expect(r.confirm).toHaveLength(1);
    expect(r.auto).toEqual([]);
  });
});
