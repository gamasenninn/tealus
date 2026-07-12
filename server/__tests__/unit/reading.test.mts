/**
 * #327 読み供給サービス。pykakasi は DI stub で差し替え（subprocess を回避）。
 */
import * as reading from '../../src/services/reading.mts';

beforeEach(() => reading._clearCache());

describe('getReadings', () => {
  test('pykakasi の読みを返す（漢字 garble）', async () => {
    const stub = async () => ({ 小坂: 'こさか', 松山: 'まつやま' });
    const m = await reading.getReadings(['小坂', '松山'], { pykakasiImpl: stub });
    expect(m.get('小坂')).toBe('こさか');
    expect(m.get('松山')).toBe('まつやま');
  });

  test('キャッシュ: 2 回目は pykakasi を呼ばない', async () => {
    let calls = 0;
    const stub = async (ts: string[]) => { calls += 1; return Object.fromEntries(ts.map((t) => [t, 'よみ'])); };
    await reading.getReadings(['甲'], { pykakasiImpl: stub });
    await reading.getReadings(['甲'], { pykakasiImpl: stub });
    expect(calls).toBe(1);
  });

  test('pykakasi が読みを返さない語は kata2hira にフォールバック（カタカナ）', async () => {
    const stub = async () => ({}); // 空
    const m = await reading.getReadings(['ホタカ'], { pykakasiImpl: stub });
    expect(m.get('ホタカ')).toBe('ほたか');
  });

  test('pykakasi が失敗しても throw せず kata2hira で埋める', async () => {
    const stub = async () => { throw new Error('uv not found'); };
    const m = await reading.getReadings(['ガマ'], { pykakasiImpl: stub });
    expect(m.get('ガマ')).toBe('がま');
  });

  test('空文字は無視', async () => {
    const stub = async (ts: string[]) => Object.fromEntries(ts.map((t) => [t, 'x']));
    const m = await reading.getReadings(['', '甲'], { pykakasiImpl: stub });
    expect(m.has('')).toBe(false);
    expect(m.get('甲')).toBe('x');
  });
});

describe('kata2hira', () => {
  test('カタカナ→ひらがな、漢字/ひらがなは素通し', () => {
    expect(reading.kata2hira('ホタカ')).toBe('ほたか');
    expect(reading.kata2hira('小坂')).toBe('小坂'); // 漢字は変換しない（だから pykakasi が要る）
  });
});
