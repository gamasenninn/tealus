/**
 * transcriptCoverage ユニットテスト (#377 の測定支援)
 *
 * ★ 何のための道具か: 議事録 v1 が raw の文を **丸ごと落とす** ことがある (2026-08-22 に
 *   organon 班が「今福さんの部長からありましたけれども」の脱落を目視で発見)。
 *   目視で気づいた件だけを数えると「0 件」が「落ちなかった」なのか
 *   「見ていない」なのか区別できない。**全文を機械的に照合して初めて 0 が意味を持つ**。
 *
 * ★ 判定を binary にしない: 整形は言い換え・フィラー除去を伴うので「一致/不一致」は決まらない。
 *   raw の各文について「出力側にどれだけ痕跡が残っているか」を 0..1 で出し、
 *   **昇順に並べる**。閾値は実データを数日見てから決める (先に決めない)。
 *
 * 指標は最長共通部分文字列の比率。理由は unit 実装のコメント参照。
 * 純粋関数・DB 非依存。
 */
import * as mod from '../../src/services/transcriptCoverage.mts';

describe('splitSentences', () => {
  test('句点・改行で切り、空文を落とす', () => {
    expect(mod.splitSentences('あいう。えお。\nかき\n\n')).toEqual(['あいう。', 'えお。', 'かき']);
  });

  test('？！でも切る', () => {
    expect(mod.splitSentences('そうですか？はい！')).toEqual(['そうですか？', 'はい！']);
  });

  test('句読点が無い一塊はそのまま 1 文', () => {
    expect(mod.splitSentences('句点のない発話')).toEqual(['句点のない発話']);
  });
});

describe('longestCommonSubstringLength', () => {
  test('完全一致は文字数そのもの', () => {
    expect(mod.longestCommonSubstringLength('あいうえお', 'あいうえお')).toBe(5);
  });

  test('部分一致は共通部分の長さ', () => {
    expect(mod.longestCommonSubstringLength('あいうえお', 'XXあいうYY')).toBe(3);
  });

  test('共通部分が無ければ 0', () => {
    expect(mod.longestCommonSubstringLength('あいう', 'かきく')).toBe(0);
  });

  test('空文字は 0', () => {
    expect(mod.longestCommonSubstringLength('', 'あいう')).toBe(0);
  });
});

describe('normalizeForCompare', () => {
  // ★ 整形は句読点と数字表記を必ず変える。そこを揃えずに比べると、
  //   残っている短い数字の文が「痕跡が無い」側に落ちる (2026-08-22 の実データで確認)。
  //   閾値を動かして合わせるのではなく、既知の変形を先に潰す。
  test('句読点・空白・かぎ括弧を落とす', () => {
    expect(mod.normalizeForCompare('本日は、晴れ。 「以上」')).toBe('本日は晴れ以上');
  });

  test('全角数字を半角に、桁区切りと通貨表記を揃える', () => {
    expect(mod.normalizeForCompare('１，７８２万円')).toBe(mod.normalizeForCompare('1782万'));
  });

  test('空文字はそのまま', () => {
    expect(mod.normalizeForCompare('')).toBe('');
  });
});

describe('coverageOf', () => {
  test('句読点だけが違う文は 1 になる', () => {
    expect(mod.coverageOf('売りかけが1782万。', '売りかけが 1,782 万円')).toBe(1);
  });

  test('そのまま残っている文は 1', () => {
    const s = '本日の朝礼を始めます。';
    expect(mod.coverageOf(s, `冒頭。${s}以上。`)).toBe(1);
  });

  test('語尾だけ整形された文は高く残る', () => {
    // 整形は言い換えを伴うが、内容語の並びは残る
    const cov = mod.coverageOf('えーと出品の写真を撮っておいてください', '出品の写真を撮っておいてください。');
    expect(cov).toBeGreaterThan(0.6);
  });

  test('丸ごと落ちた文は低く出る', () => {
    // 実例 (2026-08-22 朝礼): v1 がこの文を丸ごと落とした
    const dropped = '今福さんの部長からありましたけれども';
    const formatted = '本日の出品台数は12台です。整備A側の準備をお願いします。';
    expect(mod.coverageOf(dropped, formatted)).toBeLessThan(0.3);
  });

  test('空文は 0 (0 除算しない)', () => {
    expect(mod.coverageOf('', 'なにか')).toBe(0);
  });
});

describe('analyzeCoverage', () => {
  const RAW = [
    '本日の出品台数は12台です。',
    '今福さんの部長からありましたけれども。',
    '整備A側の準備をお願いします。',
  ].join('');
  const V1 = '本日の出品台数は12台です。整備A側の準備をお願いします。';

  test('落ちた文が先頭に来る (昇順)', () => {
    const rows = mod.analyzeCoverage(RAW, V1);
    expect(rows).toHaveLength(3);
    expect(rows[0].sentence).toContain('今福');
  });

  test('元の出現順を index で保持する', () => {
    const rows = mod.analyzeCoverage(RAW, V1);
    expect(rows[0].index).toBe(1);
    expect(rows.map((r) => r.index).sort()).toEqual([0, 1, 2]);
  });

  test('残っている文は 1 に近い', () => {
    const rows = mod.analyzeCoverage(RAW, V1);
    const kept = rows.filter((r) => r.index !== 1);
    for (const r of kept) expect(r.coverage).toBeGreaterThan(0.9);
  });

  test('出力が空なら全文が 0 (計器が死んだことを 0 件と混同しない)', () => {
    const rows = mod.analyzeCoverage(RAW, '');
    expect(rows.every((r) => r.coverage === 0)).toBe(true);
  });

  test('raw が空なら空配列', () => {
    expect(mod.analyzeCoverage('', 'なにか')).toEqual([]);
  });
});
