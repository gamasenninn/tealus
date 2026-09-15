/**
 * ★ 2026-09-15 — **同じ照合の失敗を 1 日で 5 回踏んだので、器を 1 つにする。**
 *
 * 踏んだ 5 回:
 * ```
 * 1 #435 の分母を canon の正式名で作った            (機会 9 → 実は 19)
 * 2 独立 STT の出力を漢字の完全一致で照合した        (「どちらも出ず 6 件」→ 実は 5 件は一致)
 * 3 議事録の期間をファイル名の文字列ソートで出した    (9 月の便が消えた)
 * 4 〔要確認〕を全角だけで数えかけた                (半角 [要確認] も在る)
 * 5 alias に `サンペイ` が在るのに `サンペ` で外した
 * ```
 * ★★ 共通の形: **canon 側の正規形だけで照合し、崩れを取りこぼす。**
 *   ★★★ 毎回「取りこぼす」方向に外れるので、率が良く見えたり悪く見えたりする。
 *
 * ★★★★ ただし **緩めれば良いわけではない**。短い表層で緩めると誤検出を作る
 *   (`count=1 の短い alias が誤変換を licensed にする` の形)。
 *   → ★ **3 値にして、呼び出し側に決めさせる。** 器が勝手に「一致」と言わない。
 */
import { canonSurfaces, matchCanon } from '../../src/services/canonMatch.mts';

const 三瓶 = { term: '三瓶', reading: 'さんべ', aliases: ['サンペイ', '三平', '平'] };
const 香山 = { term: '香山', reading: 'かやま', aliases: ['カヤマ', 'かやま', '岡山'] };

describe('canonSurfaces — ★ 照合に使う表層を 1 か所で作る', () => {
  it('★ 正式名 + 読み + alias を全部入れる (★★ 正式名だけで照合しない)', () => {
    const s = canonSurfaces(三瓶);
    expect(s).toContain('三瓶');
    expect(s).toContain('さんべ');
    expect(s).toContain('サンペイ');
    expect(s).toContain('三平');
  });

  it('★★ 短すぎる表層は既定で落とす (substring 雑音を作らないため)', () => {
    // ★ `平` は 1 文字。「平日」「平気」に当たる
    expect(canonSurfaces(三瓶)).not.toContain('平');
    // ★★ ただし閾値は呼び出し側が動かせる。**器が勝手に決めない**
    expect(canonSurfaces(三瓶, 1)).toContain('平');
  });

  it('重複と空白を落とす (★ 読みと alias が同じことがある)', () => {
    const s = canonSurfaces(香山);
    expect(s.filter((x) => x === 'かやま')).toHaveLength(1);
  });
});

describe('matchCanon — ★ 3 値。器が勝手に「一致」と言わない', () => {
  it('★ 表層がそのまま在れば exact', () => {
    expect(matchCanon('三瓶さんが教えてくれた', 三瓶).kind).toBe('exact');
    expect(matchCanon('サンペイさんです', 三瓶).kind).toBe('exact');
    expect(matchCanon('かやまさん、取れますか?', 香山).kind).toBe('exact');
  });

  it('★★★★ 1 字足りない崩れは near (★ 今日 5 回目に踏んだ形)', () => {
    // ★ alias `サンペイ` に対して STT は `サンペ` と出した
    const r = matchCanon('奥のスプレーあたりにあるサンペさんが教えてくれた', 三瓶);
    expect(r.kind).toBe('near');
    expect(r.surface).toBe('サンペイ');
  });

  it('★★ near は exact と混ぜない (呼び出し側が決められる形で返す)', () => {
    expect(matchCanon('サンペさん', 三瓶).kind).not.toBe('exact');
  });

  it('★★★ 短い表層では near を作らない (★ 誤検出を licensed にしない)', () => {
    // `平` (1 字) や 2 字の表層で 1 字違いを許すと、無関係な語に当たる
    const 短 = { term: 'ガマ', reading: 'がま', aliases: ['ママ'] };
    expect(matchCanon('ラマさんどこですか?', 短).kind).toBe('none');
  });

  it('★ 全角/半角・記号・空白の違いで外さない', () => {
    // ★ 実データに `高山 さん` (半角空白入り) が在った
    const 高山 = { term: '高山', reading: 'たかやま', aliases: [] };
    expect(matchCanon('高山 さん、取れますか?', 高山).kind).toBe('exact');
    expect(matchCanon('［高山］さん', 高山).kind).toBe('exact');
  });

  it('無関係な文は none', () => {
    expect(matchCanon('今日は雨ですね', 三瓶).kind).toBe('none');
  });

  it('★ 空文字で落ちない', () => {
    expect(matchCanon('', 三瓶).kind).toBe('none');
    expect(matchCanon('あ', { term: '', reading: null, aliases: [] }).kind).toBe('none');
  });
});

/**
 * ★★★★ 2026-09-15 — **実装中にテストが誤検出を 1 件捕まえた。**
 *
 * 最初の版は「落としたあと 2 字以上」で near を作っていた。
 * ★ 読み `さんべ` から 1 字落とすと `さん` になり、**敬称の「さん」に当たった**。
 *   → `サンペさんが教えてくれた` で、当たった表層が `サンペイ` ではなく `さんべ` になった。
 * ★★ 実データに当てる前に出たので、**率を汚さずに済んだ**。
 * ★★★ 直し: 落としたあとも 3 字以上あること。
 */
describe('★ 敬称に当たらないこと (2026-09-15 の回帰)', () => {
  const 三瓶 = { term: '三瓶', reading: 'さんべ', aliases: ['サンペイ'] };

  it('★★★★ 読みから 1 字落ちた `さん` が敬称に当たらない', () => {
    const r = matchCanon('サンペさんが教えてくれた', 三瓶);
    expect(r.surface).not.toBe('さんべ');
  });

  it('★ 敬称だけの文には当たらない', () => {
    const 誰か = { term: '山崎', reading: 'やまざき', aliases: [] };
    expect(matchCanon('あの人さんに聞いてください', 誰か).kind).toBe('none');
  });

  it('★★ 3 字の表層からは near を作らない (落とすと 2 字になるため)', () => {
    const 三字 = { term: 'アグリ', reading: 'あぐり', aliases: [] };
    expect(matchCanon('アグさんです', 三字).kind).toBe('none');
  });
});
