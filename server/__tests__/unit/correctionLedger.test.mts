/**
 * #440 手直しの台帳 — 訂正の 3 分類。
 *
 * ★ 分類が要る理由 (organon 班の指摘、2026-09-14)
 *   `message_edits` は「人が直した対」なので、**「raw の崩れ」と「後段が作った誤り」が
 *   同じ形で入る**。区別する列が無いと、後者が「崩れ」として上位に上がる。
 *   例 (朝礼で実際に起きた形): raw は正しく、補正段が canon の実在語に化けさせ、人が戻した。
 *   台帳には「化けた語 → 正解」しか残らず、★ **誰も言っていない語が崩れとして載る**。
 *
 * ★★ こちらから 1 つ足した: **「表記の寄せ」**。
 *   前も後も canon の表層で、人が好みの表記に寄せただけのもの (漢字の社名 → カタカナ)。
 *   誤りではないので、崩れと混ぜると上位が汚れる。
 *
 * ★★★ ② 「後段が作った誤り」は **raw が要る**ので、この版では判定しない。
 *   raw の保存は 2026-09-14 12:57:52 に別リポ側へ入れたばかりで、それ以前の便には無い。
 *   ★ 「まだ分からない」を「崩れ」に混ぜないため、`unknown` を独立の値にする。
 */
import { classifyPair, trimToChangedWindow, buildRateRows } from '../../scripts/correctionLedger.mts';

describe('trimToChangedWindow — ★ 長文を抽出器に通せる形にする', () => {
  /**
   * ★ 2026-09-14 実測: `extractAliasPairs` が使う LCS は 400 字を超える入力で null を返す
   *   (O(n·m) の dp を張るため)。通話履歴の編集本文は **平均 1,584 字・669 件中 648 件 (97%) が
   *   400 字超**。つまり決定論抽出器は、この母集団のほぼ全部を **黙って捨てていた**。
   *   台帳を通したら 369 組から訂正が 3 件しか出ず、別手段の実測 (663 件) と桁が違って気づいた。
   *
   * ★★ 直しは「上限を上げる」ではなく「渡す量を減らす」。訂正の 78% は 1〜3 文字なので、
   *   共通の前後を落とせば窓は小さくなる。前後に文脈を残すのは、抽出器が
   *   「○○さん」の "さん" を右アンカーに使うため (削ると錨を失う)。
   */
  it('共通の前後を落として、変わった部分だけ残す', () => {
    const a = 'あ'.repeat(500) + '午前' + 'い'.repeat(500);
    const b = 'あ'.repeat(500) + '飛行船' + 'い'.repeat(500);
    const w = trimToChangedWindow(a, b, 10);
    expect(w.old).toBe('あ'.repeat(10) + '午前' + 'い'.repeat(10));
    expect(w.neu).toBe('あ'.repeat(10) + '飛行船' + 'い'.repeat(10));
  });

  it('★ 文脈を指定した分だけ残す (抽出器の錨を壊さないため)', () => {
    const w = trimToChangedWindow('XXXX午前YYYY', 'XXXX飛行船YYYY', 2);
    expect(w.old).toBe('XX午前YY');
    expect(w.neu).toBe('XX飛行船YY');
  });

  it('同一なら空を返す (抽出器を呼ぶ必要が無い)', () => {
    expect(trimToChangedWindow('あいう', 'あいう', 5)).toEqual({ old: '', neu: '' });
  });

  it('★★ 片方が空でも落ちない', () => {
    expect(trimToChangedWindow('', 'あ', 3)).toEqual({ old: '', neu: 'あ' });
  });
});

const canon = new Set(['イセキ', '遺跡', '佐々木', 'ササキ', '鹿沼', '神山']);

describe('classifyPair', () => {
  it('前が canon に無ければ崩れ', () => {
    // 誰も知らない語が、canon の語に直された = 素直な聞き崩れ
    expect(classifyPair({ from: 'タイショー崩れ', to: '鹿沼' }, canon)).toBe('garble');
  });

  it('★ 前も後も canon の表層なら「表記の寄せ」', () => {
    // 人がカタカナのメーカー表記に寄せただけ。誤りではない。
    expect(classifyPair({ from: '佐々木', to: 'ササキ' }, canon)).toBe('normalize');
  });

  it('★★ 前が canon にあり、後が canon に無ければ「不明」', () => {
    // 後段が canon の実在語に化けさせた疑いがあるが、raw が無いと決められない。
    // ★ STT が自力でその語を出した可能性を排除できない。
    expect(classifyPair({ from: '神山', to: 'かぬま市の会社' }, canon)).toBe('unknown');
  });

  it('★★★ どちらも canon に無ければ「canon 外」', () => {
    // 正解語が canon に載っていない = 語を足す候補ではあるが、
    // 「canon にあるのに直せなかった」群とは性質が違うので分ける。
    expect(classifyPair({ from: 'あああ', to: 'いいい' }, canon)).toBe('outside');
  });

  it('同じ語への訂正は分類しない (差分の取り違え)', () => {
    expect(classifyPair({ from: '鹿沼', to: '鹿沼' }, canon)).toBeNull();
  });

  it('空文字は分類しない', () => {
    expect(classifyPair({ from: '', to: '鹿沼' }, canon)).toBeNull();
    expect(classifyPair({ from: '鹿沼', to: '' }, canon)).toBeNull();
  });
});

describe('buildRateRows — ★ 崩れの件数ではなく「率」で並べる', () => {
  /**
   * ★ なぜ要るか (2026-09-14 の実測で判明)
   *   崩れの件数だけで並べると順位が誤る。同じ日に実際に踏んだ:
   *     `鹿沼`  101 箇所中 53 崩れ = 52.5%
   *     `宇都宮` 97 箇所中  4 崩れ =  4.1%
   *   件数だけ見ると 53 と 4 で「鹿沼が 13 倍ひどい」に見えるが、**出現数がほぼ同じ**
   *   だったからそう読めただけ。出現 5 回で 5 回とも崩れる語は、件数では下位に沈む。
   *   ★ 台帳の目的は「上から潰す」なので、順位が誤ると潰す相手を間違える。
   *
   * ★★ 分母は **最終版 (人が直したあと) の出現数**。「本来出るべき回数」。
   *   機械が正しく出した回は人が触らないので、★ 無編集の通話も分母に入る。
   */
  const docs = [
    { final: '鹿沼市の話と鹿沼の件', orig: '神山市の話と神山の件' },   // 2/2 崩れ
    { final: '宇都宮の件', orig: '宇都宮の件' },                        // 0/1 崩れ
    { final: '鹿沼です', orig: '鹿沼です' },                            // 0/1 崩れ
  ];

  it('本来 / 出せた / 崩れ と率を出す', () => {
    const rows = buildRateRows(['鹿沼', '宇都宮'], docs);
    expect(rows).toEqual([
      { word: '鹿沼', expected: 3, produced: 1, garbled: 2, rate: 66.7 },
      { word: '宇都宮', expected: 1, produced: 1, garbled: 0, rate: 0 },
    ]);
  });

  it('★ 機械が余分に出した回は 崩れを負にしない', () => {
    // 機械が「真岡」を誤って産出した通話では、orig の出現数が final を上回りうる。
    // 負の崩れを足すと、他の通話の崩れが相殺されて母集団全体が過小になる。
    const rows = buildRateRows(['真岡'], [{ final: '真岡の件', orig: '真岡と真岡の件' }]);
    expect(rows[0].garbled).toBe(0);
  });

  it('★★ 最終版に 1 度も出ない語は 行を作らない (分母 0)', () => {
    // 2026-09-14 実測: `真岡` は 30 日で最終版に 0 回。★ 率が定義できない。
    // 0% と書くと「完璧に出せている」に読める。**行ごと出さない。**
    expect(buildRateRows(['真岡'], [{ final: 'あ', orig: 'い' }])).toEqual([]);
  });
});
