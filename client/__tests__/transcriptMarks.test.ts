import { describe, it, expect } from 'vitest';
import { parseTimestampMarks } from '../src/utils/transcriptMarks';

/**
 * 通話履歴の本文に入る時刻タグ `[m:ss]` を拾う (SP2TXT が 2026-08-29 17:45 から出力)。
 *
 * ★ タグは再生位置と一致している (user 確認済み) ので、拾った秒数はそのまま seek に使える。
 * ★ タグの体裁は 1 通の中で 2 通りある (`[0:00] 本文` と `[1:05]` + 改行)。両方拾えること。
 */
describe('parseTimestampMarks', () => {
  it('m:ss を秒に直す', () => {
    expect(parseTimestampMarks('[0:00] 飛行船です。\n[1:02] トラクター')).toEqual([
      { label: '0:00', seconds: 0 },
      { label: '1:02', seconds: 62 },
    ]);
  });

  it('★ タグの次行から本文が始まる形も拾う', () => {
    const text = 'そうですね。\n\n[1:05]\nちょっと、なるべく';
    expect(parseTimestampMarks(text)).toEqual([{ label: '1:05', seconds: 65 }]);
  });

  it('h:mm:ss も拾う (長い通話)', () => {
    expect(parseTimestampMarks('[1:02:03] 長電話')).toEqual([
      { label: '1:02:03', seconds: 3723 },
    ]);
  });

  it('同じ時刻が 2 度出ても 1 つにまとめる', () => {
    expect(parseTimestampMarks('[2:07] あ\n[2:07] い')).toEqual([
      { label: '2:07', seconds: 127 },
    ]);
  });

  it('★ 秒が 60 以上のものは時刻として扱わない (型式や寸法の誤検出を避ける)', () => {
    expect(parseTimestampMarks('[1:75] これは時刻ではない')).toEqual([]);
  });

  it('タグが無い本文では空 (タグ以前の便・音声メッセージ)', () => {
    expect(parseTimestampMarks('はい、飛行船です。\n\nもしもし。')).toEqual([]);
  });

  it('出現順を保つ', () => {
    const marks = parseTimestampMarks('[2:07] あ\n[0:00] い\n[1:02] う');
    expect(marks.map((m) => m.label)).toEqual(['2:07', '0:00', '1:02']);
  });
});
