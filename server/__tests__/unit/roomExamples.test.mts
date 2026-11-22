/**
 * 部屋の「人が直した例」を補正段に載せる (docs/15)。例の選び方は純粋な関数で、DB を読む部分と分けている。
 * ★ 名前は架空 (甲野・乙山・丙川)。実データの名前を公開リポジトリに書かない。
 */
import * as mod from '../../src/services/roomExamples.mts';

const T0 = Date.parse('2026-11-01T00:00:00Z');
const at = (h: number) => new Date(T0 + h * 3600e3).toISOString();
// 1 便 = 版 1 (raw + AI の整形) → 人の最新版
const msg = (id: string, h: number, raw: string, ai: string, human: string | null) => ({ id, created_at: at(h), raw, ai, human });
const TERMS = ['甲野', '乙山', '丙川部長', '整備場'];

describe('diffOps (文字単位の差分)', () => {
  test('同じなら equal だけ', () => {
    expect(mod.diffOps('あいう', 'あいう').map((o) => o.op)).toEqual(['equal']);
  });
  test('置き換えを 1 つの replace として返す', () => {
    const ops = mod.diffOps('釜さん取れますか', '甲野さん取れますか');
    const r = ops.find((o) => o.op === 'replace')!;
    expect('釜さん取れますか'.slice(r.i1, r.i2)).toBe('釜');
    expect('甲野さん取れますか'.slice(r.j1, r.j2)).toBe('甲野');
  });
});

describe('correctionPattern (人が辞書の語に直した所)', () => {
  test('AI の版に無く人の版で増えた辞書の語と、置き換えられた元の文字列', () => {
    expect(mod.correctionPattern('釜さん、取れますか', '甲野さん、取れますか', TERMS)).toEqual({ wrong: '釜', label: '甲野' });
  });
  test('辞書の語が増えていなければ null (句読点だけの直しなど)', () => {
    expect(mod.correctionPattern('甲野さん取れますか', '甲野さん、取れますか', TERMS)).toBeNull();
  });
  test('置き換えられた元が長すぎる (13 字以上) なら null', () => {
    expect(mod.correctionPattern('ああああああああああああああ', '甲野', TERMS)).toBeNull();
  });
  test('長い語を先に見る (丙川部長 と 丙川 があれば 丙川部長)', () => {
    expect(mod.correctionPattern('大川部長、取れますか', '丙川部長、取れますか', [...TERMS, '丙川'])?.label).toBe('丙川部長');
  });
});

describe('selectExamples', () => {
  const rows = [
    msg('1', 1, '釜さん、取れますか', '釜さん、取れますか', '甲野さん、取れますか'),
    msg('2', 2, '釜さん、了解', '釜さん、了解', '甲野さん、了解'),
    msg('3', 3, '今、取れますか', '今、取れますか', '甲野、取れますか'),
    msg('4', 4, '小山さん、お願いします', '小山さん、お願いします', '乙山さん、お願いします'),
    msg('5', 5, '整備場、取れますか。はい', '整備場、取れますか。はい', '整備場、取れますか。はい、取れます'), // 人が直したが呼びかけはそのまま
    msg('6', 6, 'あいう', 'あいう', null), // 人が直していない
  ];

  test('人が直した便が少なすぎる部屋には載せない (minEdited)', () => {
    expect(mod.selectExamples(rows, TERMS, { minEdited: 10 })).toBeNull();
  });

  test('同じ崩れ方 (釜→甲野) は 1 例だけ。多い崩れ方から並べる', () => {
    const ex = mod.selectExamples(rows, TERMS, { minEdited: 1 })!;
    const fixed = ex.corrections.map((e) => e.raw);
    expect(fixed[0]).toBe('釜さん、取れますか'); // 釜→甲野 が 2 回で最多。最初の便
    expect(fixed.filter((r) => r.startsWith('釜')).length).toBe(1);
    expect(fixed).toEqual(expect.arrayContaining(['今、取れますか', '小山さん、お願いします']));
  });

  test('1 語あたりの例は上限まで', () => {
    const many = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, i, `x${i}y、了解`, `x${i}y、了解`, '甲野、了解'));
    const ex = mod.selectExamples(many, TERMS, { minEdited: 1, perLabel: 3 })!;
    expect(ex.corrections.length).toBe(3);
  });

  test('raw が長い便は例にしない', () => {
    const long = [msg('L', 1, '釜さん、' + 'あ'.repeat(200), '釜さん、' + 'あ'.repeat(200), '甲野さん、' + 'あ'.repeat(200))];
    expect(mod.selectExamples(long, TERMS, { minEdited: 1 })!.corrections).toEqual([]);
  });

  test('「そのまま正しかった例」= 人が直した便で、文頭の呼びかけを人が変えなかった呼び出しの便', () => {
    const ex = mod.selectExamples(rows, TERMS, { minEdited: 1 })!;
    expect(ex.kept.map((e) => e.raw)).toEqual(['整備場、取れますか。はい']);
  });

  test('窓より古い便は使わない', () => {
    const now = Date.parse(at(1000));
    expect(mod.selectExamples(rows, TERMS, { minEdited: 1, windowDays: 1, now })).toBeNull();
  });
});

describe('examplesBlock', () => {
  const ex = { corrections: [{ raw: '釜さん', human: '甲野さん' }], kept: [{ raw: '整備場、取れますか', human: '整備場、取れますか' }] };

  test('見出し・1 例 2 行 (左 raw、→ 人の版)・最後に空行', () => {
    const b = mod.examplesBlock(ex);
    expect(b.startsWith('## このルームで人が直した例')).toBe(true);
    expect(b).toContain('- 釜さん\n  → 甲野さん');
    expect(b).toContain('- 整備場、取れますか\n  → 整備場、取れますか');
    expect(b.endsWith('\n\n')).toBe(true);
  });

  test('★ 全体を慎重にする文 (文脈が合うときだけ) を入れない (得が消えた実験、docs/15 §5)', () => {
    expect(mod.examplesBlock(ex)).not.toContain('文脈');
  });

  test('字数の上限を超えたら、後ろの例から落とす (直した例より、そのまま正しかった例を先に落とす)', () => {
    const big = { corrections: Array.from({ length: 30 }, (_, i) => ({ raw: `r${i}`.padEnd(100, 'あ'), human: `h${i}`.padEnd(100, 'い') })), kept: [{ raw: 'k', human: 'k' }] };
    const b = mod.examplesBlock(big, 3000);
    expect(b.length).toBeLessThanOrEqual(3000);
    expect(b).toContain('r0');
    expect(b).not.toContain('\n- k\n');
  });

  test('例が無ければ空文字', () => {
    expect(mod.examplesBlock({ corrections: [], kept: [] })).toBe('');
  });
});
