/**
 * #446 段 1 — 固有名詞の読みを TTS の前段で当てる (★ 1 語だけから始める)。
 *
 * ★ 経緯: OpenAI は「鹿沼」を **シカヌマ** と読む (★★ Aivis は カヌマ)。
 *   ★★★ `instructions` では直らないことを実測済み。★ 本文を書き換えるしかない。
 *
 * ★★★★ **一括置換は採らない。** 記憶に「決定論の前段補正は精度≈0%」の実績がある。
 *   ★ 辞書 259 語を一度に入れず、★★ **読み違えると確かめた語だけ**を表に足す。
 *
 * ★★ ここで固定したい性質は 4 つ:
 *   ① 表に在る語だけが変わる (★ 他は 1 文字も変わらない)
 *   ② 長い語が先に当たる (★★ 包含 22 組を壊さない)
 *   ③ 数字だけの語は対象外 (★★★ 「44」が term として登録されており 30 日で 292 回当たっていた)
 *   ④ 何をいくつ置換したかを返す (★ 黙って書き換えない)
 */
import { applyReadingHints, READING_HINTS } from '../../src/lib/tts-reading.mts';

describe('applyReadingHints — ★ 読みを当てる', () => {
  test('★ 表に在る語が読みに置き換わる', () => {
    const got = applyReadingHints('鹿沼の現場に行きます', { 鹿沼: 'カヌマ' });
    expect(got.text).toBe('カヌマの現場に行きます');
    expect(got.applied).toEqual([{ term: '鹿沼', reading: 'カヌマ', count: 1 }]);
  });

  test('★ 同じ語が複数回あれば全部置き換え、回数を返す', () => {
    const got = applyReadingHints('鹿沼から鹿沼へ', { 鹿沼: 'カヌマ' });
    expect(got.text).toBe('カヌマからカヌマへ');
    expect(got.applied[0].count).toBe(2);
  });

  test('★★ 表に無い語は 1 文字も変わらない', () => {
    const src = '宇都宮の現場に行きます';
    const got = applyReadingHints(src, { 鹿沼: 'カヌマ' });
    expect(got.text).toBe(src);
    expect(got.applied).toEqual([]);
  });

  test('★★★★ 長い語が先に当たる (★ 包含を壊さない)', () => {
    // ★ 鹿沼 ⊂ 鹿沼梱包。短い方が先に当たると「カヌマ梱包」になり、
    //   ★★ 表に在る「鹿沼梱包」の読みが使われなくなる。
    const got = applyReadingHints('鹿沼梱包に電話して', { 鹿沼: 'カヌマ', 鹿沼梱包: 'カヌマコンポウ' });
    expect(got.text).toBe('カヌマコンポウに電話して');
    expect(got.applied).toEqual([{ term: '鹿沼梱包', reading: 'カヌマコンポウ', count: 1 }]);
  });

  test('★★★ 数字だけの語は対象外 (★ 「44」は term として登録されている)', () => {
    const got = applyReadingHints('44 番の機械と 4444 円', { 44: 'ヨンヨン' });
    expect(got.text).toBe('44 番の機械と 4444 円');
    expect(got.applied).toEqual([]);
  });

  test('★★ 1 文字の語も対象外 (★ substring 雑音が大きすぎる)', () => {
    const got = applyReadingHints('川のそばで', { 川: 'カワ' });
    expect(got.text).toBe('川のそばで');
    expect(got.applied).toEqual([]);
  });

  test('★ 空文字・null で壊れない', () => {
    expect(applyReadingHints('', { 鹿沼: 'カヌマ' }).text).toBe('');
    expect(applyReadingHints(null as unknown as string, { 鹿沼: 'カヌマ' }).text).toBe('');
  });

  test('★★★★ 既定の表は **聞いて確かめた語だけ** (★ 事後に黙って増やさないことを固定する)', () => {
    // ★ この一覧が黙って増えていたら、★★ 測らずに足されたということ。
    //   ★★★ 増やすときは **必ずここも直す** = 意識的に増やす形にしてある。
    //
    // ★ 2026-09-17 段 2 の実測: 候補 19 語を聞いて、★★ 読み違えたのは 4 語だけだった (21%)。
    //   ★★★ 正しく読めていた 15 語は入れない (= 触る理由が無い)。
    expect(Object.keys(READING_HINTS).sort()).toEqual(
      ['五月女', '小川朱美', '小野哲', '清野', '鹿沼'].sort(),
    );
    expect(READING_HINTS['鹿沼']).toBe('カヌマ');
    expect(READING_HINTS['五月女']).toBe('ソウトメ');
  });

  test('★ 既定の表を使うと 鹿沼 が カヌマ になる', () => {
    const got = applyReadingHints('鹿沼店の在庫を見てください');
    expect(got.text).toBe('カヌマ店の在庫を見てください');
  });
});
