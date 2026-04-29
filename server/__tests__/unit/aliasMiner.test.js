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
