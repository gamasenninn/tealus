/**
 * テスト実行中は本番ログファイルへ書かない
 *
 * ★ なぜ: logger は NODE_ENV に関係なく `agent-server/logs/agent-%DATE%.log` へ
 *   DailyRotateFile を張っていた。そのため `npm test` を流すと、テストの出力が
 *   **本番の運用ログに混ざる**。
 *
 * ★★ 2026-08-30 実測: 17:25 に npm test を流したところ、本番ログに 40 行入った。
 *   中身が問題で、たとえばこう見える:
 *
 *     [delegator] target agent error in B: boom
 *     [delegator] multi: all 2 targets failed (origin=O)
 *
 *   `boom` はテストのフィクスチャだが、**ログだけ見ると本番の障害**である。
 *   後からログを追う人が、起きていない障害を調べることになる。
 */
import { logger } from '../../src/lib/logger.mts';

function transportNames(): string[] {
  return logger.transports.map((t) => t.constructor.name);
}

describe('logger の transport (テスト実行中)', () => {
  test('★ ファイルローテーション transport が張られていない', () => {
    expect(transportNames()).not.toContain('DailyRotateFile');
  });

  test('★ ファイルへ書く transport が 1 つも無い (実装が別クラスに変わっても効く)', () => {
    const fileish = logger.transports.filter(
      (t) => 'dirname' in t || 'filename' in t
    );
    expect(fileish).toHaveLength(0);
  });

  test('Console は残る (テスト出力では今までどおり見える)', () => {
    expect(transportNames()).toContain('Console');
  });

  test('transport が空にはならない (全部消して黙らせるのは行き過ぎ)', () => {
    expect(logger.transports.length).toBeGreaterThan(0);
  });
});
