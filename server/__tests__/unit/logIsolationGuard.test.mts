/**
 * ★★ テストが本番のログファイルに書かないことを固定する (2026-09-08)
 *
 * 実害: 2026-09-07 の本番ログに、テストの fixture の値がそのまま残っていた
 * (`[stt] gemini ok 0ms vocab=3`、`「حسن」`、`「每句一个」`、`[dictionary] … by DICTADM`)。
 *
 * ★★★ 実害はログの汚れだけではない。**同じ日に私が 2 回、誤った結論を出した** ——
 *   テストの行を「本番の状態」と読んで、「本番 server の辞書 overlay が 1 語に壊れた」
 *   「悪い文字起こしは語彙の崩れが原因」と報告した。どちらも実際には起きていなかった。
 *   **本番とテストが同じログファイルを共有していると、行だけでは区別できない。**
 *
 * ★ 個別に `jest.mock('../../src/utils/logger.mts')` を足す形は 2026-08-30 に始めたが、
 *   81 ファイル中 11 ファイルしか塞げておらず、`request(app)` を使う統合テストが 20 件以上
 *   素通りしていた。**入口 (jest.setup.js) で一括して止める。**
 *
 * ★★ `logger.mts` は `dirname` を固定で持つので env では逸らせない。モジュールごと差し替える。
 */
describe('ログの隔離 — テストは本番のログファイルに書かない', () => {
  test('★★ logger が本番の transport を持っていない (差し替わっている)', () => {
    const { logger } = require('../../src/utils/logger.mts') as {
      logger: { transports?: unknown[]; info: unknown; warn: unknown; error: unknown; debug: unknown };
    };
    // ★ 本物の winston logger は transports を持つ。テスト用のものは持たない (= 出力先が無い)
    expect(logger.transports === undefined || (logger.transports as unknown[]).length === 0).toBe(true);
  });

  test('★ それでも呼べる形は保つ (info / warn / error / debug)', () => {
    const { logger } = require('../../src/utils/logger.mts') as {
      logger: Record<string, unknown>;
    };
    for (const m of ['info', 'warn', 'error', 'debug']) {
      expect(typeof logger[m]).toBe('function');
      expect(() => (logger[m] as (s: string) => void)('テストの出力が本番へ行かないこと')).not.toThrow();
    }
  });

  test('★ LOG_TIMESTAMP_FORMAT のような同モジュールの export は生きている (#359 の契約)', () => {
    const mod = require('../../src/utils/logger.mts') as { LOG_TIMESTAMP_FORMAT?: string };
    expect(mod.LOG_TIMESTAMP_FORMAT).toBe('YYYY-MM-DD HH:mm:ss.SSS');
  });
});
