/**
 * Migration の **純粋な判断だけ**を置く (#406 / 2026-09-19 切り出し)。
 *
 * ★ なぜ別ファイルか: `migrate.mts` は `pg` / `dotenv` を import する。
 *   agent-server の doctor がこの判断を使うために `migrate.mts` を import した結果、
 *   **agent-server の型検査が server の依存まで要求する**ようになった。
 *   ★★ CI の agent-server job は `agent-server/` でしか `npm ci` しないので
 *   `server/node_modules` が無く、**手元では通るのに CI だけ落ちる**状態が 2026-09-15 から続いた
 *   (★★★ 手元は `server/node_modules` が在るので気づけない)。
 *
 * ★ ここには **import を 1 行も置かない**。置いた瞬間に同じことが起きる。
 */

/** 未適用のファイルを、ファイル名の昇順で返す */
export function planMigrations(files: string[], applied: Set<string>): string[] {
  return [...files].sort().filter((f) => !applied.has(f));
}

/**
 * 台帳が無い DB に対して、そのまま流してよいか。
 * ★ テーブルが既に在るなら止める (fail-loud)。黙って進めると、未適用のものを飛ばして静かに壊れる。
 */
export function needsBaseline(hasLedger: boolean, hasUserTables: boolean): boolean {
  return !hasLedger && hasUserTables;
}
