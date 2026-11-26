/**
 * #664 の 1: 件数・飛ばす数の読み方 (utils/queryLimit.mts)
 */
import { parseLimit, parseOffset } from '../../src/utils/queryLimit.mts';

describe('parseLimit', () => {
  test.each([
    [undefined, 30], ['', 30], ['abc', 30], ['0', 30],   // 無い・数でない・0 は既定
    ['-5', 1], ['1', 1], ['20', 20], ['100', 100], ['1000', 100], ['12abc', 12], [7, 7],
  ])('%p → %p (既定 30・上限 100)', (v, want) => {
    expect(parseLimit(v, 30, 100)).toBe(want);
  });
});

describe('parseOffset', () => {
  test.each([[undefined, 0], ['abc', 0], ['-3', 0], ['0', 0], ['15', 15]])('%p → %p', (v, want) => {
    expect(parseOffset(v)).toBe(want);
  });
});
