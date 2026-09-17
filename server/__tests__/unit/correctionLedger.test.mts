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
import { classifyPair, trimToChangedWindow, buildRateRows, pairVersions, extractVid, judgeByRaw, coverageNote, splitHistoryAndFinals, canonMismatchWarning } from '../../scripts/correctionLedger.mts';

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

/**
 * ★ 2026-09-15 — **台帳が最後の 1 手を見ていなかった。**
 *
 * `message_edits` は **過去の版**を持ち、**最終版は `messages.content`** にある。
 * 版を連続で組むだけだと、**最後の遷移 (= 人が受け入れた訂正) が丸ごと落ちる**。
 *
 * ★★ 実測 (通話履歴 / 直近 14 日、2026-09-15):
 * ```
 * 編集のあったメッセージ 310 件 / edit 行 702 行
 * ★ 版を連続で組んだ対        392 組   ← 台帳が見ていた分
 * ★★★★ 落ちていた最後の遷移   310 組 (44%)
 * ★★ うち 1 回だけ編集された 127 件は **対が 0 件** = 丸ごと不可視
 * ★★★ 310 件すべてで 最後の edit 行 ≠ messages.content (= 最後の遷移は実在する)
 * ```
 * ★ これは「10 倍の開き」の形をしていて、issue 本文の別手段の実測 (14 日で 663) と
 *   台帳の出力 (71) が合わなかった理由の一つ。
 */
describe('pairVersions — ★ 最終版を対に含める (2026-09-15)', () => {
  const rows = [
    { message_id: 'a', version: 1, content: 'あ1' },
    { message_id: 'a', version: 2, content: 'あ2' },
    { message_id: 'b', version: 1, content: 'い1' },
  ];
  const finals = new Map([['a', 'あ最終'], ['b', 'い最終']]);

  it('★ 版の間に加えて、最後の版 → 最終版 も対にする', () => {
    const out = pairVersions(rows, finals);
    expect(out).toEqual([
      { old: 'あ1', neu: 'あ2' },
      { old: 'あ2', neu: 'あ最終' },
      { old: 'い1', neu: 'い最終' },
    ]);
  });

  it('★★ 1 回だけ編集されたメッセージが 見えるようになる (これまで 0 組だった)', () => {
    const out = pairVersions([{ message_id: 'b', version: 1, content: 'い1' }], finals);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ old: 'い1', neu: 'い最終' });
  });

  it('★ 最終版が引けないメッセージは 最後の遷移を作らない (推測しない)', () => {
    const out = pairVersions([{ message_id: 'z', version: 1, content: 'ざ1' }], new Map());
    expect(out).toHaveLength(0);
  });

  it('★★ 最終版が最後の版と同じなら 対にしない (変化なし)', () => {
    const out = pairVersions(
      [{ message_id: 'c', version: 1, content: '同じ' }],
      new Map([['c', '同じ']]),
    );
    expect(out).toHaveLength(0);
  });

  it('★★★ メッセージが混ざっても取り違えない', () => {
    const out = pairVersions(
      [
        { message_id: 'a', version: 1, content: 'あ1' },
        { message_id: 'b', version: 1, content: 'い1' },
        { message_id: 'b', version: 2, content: 'い2' },
      ],
      finals,
    );
    expect(out).toEqual([
      { old: 'あ1', neu: 'あ最終' },
      { old: 'い1', neu: 'い2' },
      { old: 'い2', neu: 'い最終' },
    ]);
  });
});

/**
 * ★ 2026-09-15 — **raw が揃ったので「後段が作った誤り」を判定できるようになった。**
 *
 * ★★ #440 は列を 3 値にしたが、`unknown` (= 後段が作った疑い) は
 *   **raw が無いと決められない**ので判定を保留していた。
 *   2026-09-14 から `raw_store.py` が 1 通話 1 file で raw を残すようになったので、
 *   **同一便の raw を引いて決められる**:
 *
 * ```
 * ★ 訂正前の語が raw に在る   → STT が出した = ★★ 崩れ (①)
 * ★ 訂正前の語が raw に無い   → 後段が作った  = ★★ 誤り (②)
 * ★★★ raw が無い              → ★ **決めない** (「無い」を「①」に倒さない)
 * ```
 *
 * ★★★★ 鍵は本文にある: 通話履歴の本文 1 行目が `【通話】sum_<vid> / ...` で、
 *   raw は `raw_<vid>.txt`。**新しい対応表を作る必要は無い。**
 */
describe('extractVid — ★ 本文から raw への鍵', () => {
  it('★ 1 行目の sum_<vid> を拾う', () => {
    expect(extractVid('【通話】sum_84966 / 2026-09-14 17:05\n【カテゴリ】…')).toBe('84966');
  });

  it('見つからなければ null (推測しない)', () => {
    expect(extractVid('【通話】なし')).toBeNull();
    expect(extractVid('')).toBeNull();
  });

  it('★★ 本文の後ろに別の sum_ が出ても 最初のものを使う', () => {
    expect(extractVid('【通話】sum_100 / x\n本文に sum_999 と書いてある')).toBe('100');
  });
});

describe('judgeByRaw — ★ 3 値。「raw が無い」を「崩れ」に倒さない', () => {
  it('★ 訂正前の語が raw に在れば STT が出した (= 崩れ)', () => {
    expect(judgeByRaw('午前', 'はい、午前です。')).toBe('stt');
  });

  it('★★ raw に無ければ 後段が作った', () => {
    expect(judgeByRaw('久保田', 'はい、久保部長お願いします。')).toBe('stage');
  });

  it('★★★ raw が引けなければ 決めない', () => {
    expect(judgeByRaw('午前', null)).toBe('no-raw');
  });

  it('★ 空の訂正前は決めない (差分の取り違え)', () => {
    expect(judgeByRaw('', 'なんでも')).toBe('no-raw');
  });
});

describe('coverageNote — ★ 台帳が「自分が見ていない分」を自分で言う (#440)', () => {
  /**
   * ★ 2026-09-17 実測: 台帳は `message_edits` で作っているが、文字起こしの訂正は
   *   `voice_transcriptions` に入るので **1 行も見えていなかった** (30 日で 707 回 = 人手の 37.4%)。
   *
   * ★★ 「順位は正しいが分母が足りない」型の誤りは、★★★ **台帳自身が言わないと気づけない。**
   *   #441 の「沈黙を正常の合図にしない」と同じ形を、台帳の出力に入れる。
   *
   * ★★★★ **いちばん大事な性質**: 見ていない先が 0 件でも **「100%」と言わせない。**
   *   知っている取りこぼしが無いことは、取りこぼしが無いことの証拠ではない。
   */
  it('見ていない先があるとき、割合と中身の両方を出す', () => {
    const lines = coverageNote(1182, [{ where: 'voice_transcriptions', n: 707, note: '文字起こしの訂正' }]);
    const joined = lines.join('\n');
    expect(joined).toContain('1182');
    expect(joined).toContain('1889');       // ★ 合計を出す (分母を隠さない)
    expect(joined).toContain('62.6%');
    expect(joined).toContain('voice_transcriptions');
    expect(joined).toContain('707');
    expect(joined).toContain('文字起こしの訂正');
  });

  it('★ 見ていない先が 0 件でも「100%」とは言わない', () => {
    const joined = coverageNote(1182, []).join('\n');
    expect(joined).not.toContain('100%');
    expect(joined).toContain('未調査');      // ★ 「無い」ではなく「調べていない」と言う
  });

  it('★ 0 件でも壊れない (ゼロ除算を出さない)', () => {
    const joined = coverageNote(0, []).join('\n');
    expect(joined).not.toContain('NaN');
    expect(joined).not.toContain('Infinity');
  });

  it('★ 複数の取りこぼし先を全部出す', () => {
    const joined = coverageNote(100, [
      { where: 'voice_transcriptions', n: 50, note: 'A' },
      { where: 'another_table', n: 25, note: 'B' },
    ]).join('\n');
    expect(joined).toContain('voice_transcriptions');
    expect(joined).toContain('another_table');
    expect(joined).toContain('175');        // ★ 100 + 50 + 25
  });
});

describe('splitHistoryAndFinals — ★ 版の履歴と最終版を分ける (#440 案 1)', () => {
  /**
   * ★ `message_edits` は「過去の版」だけを持ち、最終版は `messages.content` に在る。
   *   ★★ `voice_transcriptions` は **最終版も同じ表に在る**ので、形を揃える必要がある。
   *
   * ★★★ pairVersions は (履歴の行, 最終版の map) を取るので、
   *   ★★★★ **最大 version を finals へ、それ以外を history へ**分ける。
   *   ★ ここを間違えると、最終版が「履歴」と対になって **1 組多く数える**。
   */
  it('版が 1 つだけなら history は空、finals に入る', () => {
    const { history, finals } = splitHistoryAndFinals([
      { message_id: 'm1', version: 1, content: 'A' },
    ]);
    expect(history).toEqual([]);
    expect(finals.get('m1')).toBe('A');
  });

  it('版が 2 つなら v1 が history、v2 が finals', () => {
    const { history, finals } = splitHistoryAndFinals([
      { message_id: 'm1', version: 1, content: 'A' },
      { message_id: 'm1', version: 2, content: 'B' },
    ]);
    expect(history.map((r) => r.content)).toEqual(['A']);
    expect(finals.get('m1')).toBe('B');
  });

  it('★ 3 版なら v1,v2 が history、v3 が finals', () => {
    const { history, finals } = splitHistoryAndFinals([
      { message_id: 'm1', version: 1, content: 'A' },
      { message_id: 'm1', version: 2, content: 'B' },
      { message_id: 'm1', version: 3, content: 'C' },
    ]);
    expect(history.map((r) => r.content)).toEqual(['A', 'B']);
    expect(finals.get('m1')).toBe('C');
  });

  it('★★ 複数メッセージが混ざっていても message_id ごとに分かれる', () => {
    const { history, finals } = splitHistoryAndFinals([
      { message_id: 'm1', version: 1, content: 'A1' },
      { message_id: 'm1', version: 2, content: 'A2' },
      { message_id: 'm2', version: 1, content: 'B1' },
    ]);
    expect(history.map((r) => r.content).sort()).toEqual(['A1']);
    expect(finals.get('m1')).toBe('A2');
    expect(finals.get('m2')).toBe('B1');
  });

  it('★★★ 版の順序が崩れた入力でも 最大 version が finals になる', () => {
    const { history, finals } = splitHistoryAndFinals([
      { message_id: 'm1', version: 3, content: 'C' },
      { message_id: 'm1', version: 1, content: 'A' },
      { message_id: 'm1', version: 2, content: 'B' },
    ]);
    expect(finals.get('m1')).toBe('C');
    expect(history.map((r) => r.content).sort()).toEqual(['A', 'B']);
  });

  it('★ 空入力で壊れない', () => {
    const { history, finals } = splitHistoryAndFinals([]);
    expect(history).toEqual([]);
    expect(finals.size).toBe(0);
  });
});

describe('canonMismatchWarning — ★ 経路とものさしの食い違いを黙らせない (#440 案 1)', () => {
  /**
   * ★★★★ このファイル冒頭が既に警告している:
   * ```
   * 通話履歴 (別リポ)  organon.ttl を直読み   → 鹿沼 は在る
   * 朝礼 / 補正段      辞書テーブル (射影)    → 鹿沼 は無い
   * ```
   * ★ 案 1 で voice_transcriptions を取り込んだことで、★★ **既定 (ttl) のまま
   *   本体の音声経路を測れてしまう**ようになった。★★★ 実測で数字が変わる
   *   (トランシーバー履歴 30 日: 崩れ ttl 357 / dict 296)。
   * → ★★★★ **自動で選ばない。** 選ぶのは人。★ ただし **食い違っていたら言う**。
   */
  it('★ voice 由来が在るのに canon=ttl なら警告する', () => {
    const w = canonMismatchWarning('ttl', 708, 0);
    expect(w).not.toBeNull();
    expect(w).toContain('dict');
  });

  it('voice 由来が在って canon=dict なら警告しない', () => {
    expect(canonMismatchWarning('dict', 708, 0)).toBeNull();
  });

  it('★ voice 由来が無ければ ttl でも警告しない (★★ 通話履歴は ttl が正しい)', () => {
    expect(canonMismatchWarning('ttl', 0, 1131)).toBeNull();
  });

  it('★★★★ 両方の在り処が混ざったら、どちらの canon でも警告する', () => {
    // ★ 1 つのルームに 2 経路が混ざると、★★ **単一の canon では正しく測れない**
    expect(canonMismatchWarning('ttl', 10, 10)).not.toBeNull();
    expect(canonMismatchWarning('dict', 10, 10)).not.toBeNull();
  });
});
