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
import { classifyPair, trimToChangedWindow } from '../../scripts/correctionLedger.mts';

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
