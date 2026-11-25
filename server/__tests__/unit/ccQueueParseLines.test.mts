/**
 * 改善ループ 111: 受け箱 (jsonl) の行の読み方。/stream・/pending の非同期の読みと、
 * 購読の登録直後の同期の読み直しが同じ読み方を 2 回書いていた。1 つにまとめ、読み方をここで決める。
 */
import { parseQueueLines } from '../../src/routes/ccQueue.mts';

describe('parseQueueLines', () => {
  it('1 行 1 便で、順を保つ', () => {
    expect(parseQueueLines('{"id":"a"}\n{"id":"b"}\n')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('空の行は飛ばす', () => {
    expect(parseQueueLines('\n{"id":"a"}\n\n')).toEqual([{ id: 'a' }]);
  });

  it('壊れた行は捨て、前後は残す', () => {
    expect(parseQueueLines('{"id":"a"}\n{oops\n{"id":"b"}\n')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('改行で終わらない最後の行も、読めれば便として扱う (今の動き)', () => {
    expect(parseQueueLines('{"id":"a"}\n{"id":"b"}')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('空のファイルは 0 便', () => {
    expect(parseQueueLines('')).toEqual([]);
  });
});
