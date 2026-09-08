/**
 * ★★ テストが本番のログファイルに書かないようにする (2026-09-08)
 *
 * `server/src/utils/logger.mts` は winston の DailyRotateFile を **dirname 固定**で持つため、
 * env では逸らせない。ここでモジュールごと差し替えて、**全テストに一括で効かせる**。
 *
 * 実害:
 *   - 2026-09-07 の本番ログに、テストの fixture がそのまま残った
 *     (`[stt] gemini ok 0ms vocab=3` / `「حسن」` / `[dictionary] … by DICTADM`)
 *   - ★★★ 2026-09-08、私はその行を「本番の状態」と読んで **2 回 誤った結論**を出した
 *     (「本番の辞書 overlay が 1 語に壊れた」「悪い文字起こしは語彙の崩れが原因」)。
 *     どちらも実際には起きていなかった。**本番とテストが同じログを共有すると、
 *     行だけでは区別できない。** 汚れよりこちらの被害が大きい。
 *
 * ★ 個別に jest.mock を足す形は 2026-08-30 に始めたが、81 ファイル中 11 しか塞げておらず、
 *   `request(app)` を使う統合テストが 20 件以上 素通りしていた。**入口で止める。**
 *
 * ★★ `LOG_TIMESTAMP_FORMAT` など同モジュールの export は実物を残す (#359 の契約を壊さない)。
 */
jest.mock('./src/utils/logger.mts', () => ({
  // #359: agent-server と揃えた形式。テストで固定してあるので実値を返す
  LOG_TIMESTAMP_FORMAT: 'YYYY-MM-DD HH:mm:ss.SSS',
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    // ★ transports は持たせない —— 出力先が無いことが、このモジュールの目的
  },
}));
