/**
 * #334 未適用 migration の起動時 warn — 採用者保護 (checkBuildArtifacts と同型 pattern)。
 *
 * 背景: `npm run migrate` は手動実行で、採用者が更新時に忘れると #327 の辞書テーブル
 * (023-025) が無いまま起動する。refreshVocabFromTable が file フォールバックで catch する
 * ため **クラッシュせず稼働は継続**するが、辞書育成タブ (admin) が 500 になり自己成長辞書が
 * 静かに効かない (= silent degrade、採用者が気づけない)。
 *
 * checkBuildArtifacts (client/dist 不在の loud warn) と同じ思想で、起動時に中核テーブルの
 * 存在を確認し、無ければ「次に打つコマンド」を loud warn して setup 漏れを可視化する。
 *
 * DB 非依存にするため query / warn は注入する (テストは pool に触れない)。
 */

/** 存在を確認する中核テーブル (#327 辞書、023 で作成)。023 が無ければ 024/025 も無い。 */
const CORE_TABLE = 'dictionary_terms';

export interface MigrationCheckDeps {
  /** SELECT を投げる関数 (本番は pool.query)。テーブル不在なら pg が 42P01 を throw する。 */
  query: (sql: string) => Promise<unknown>;
  /** warn 出力 (本番は logger.warn)。 */
  warn: (message: string) => void;
}

/**
 * 中核テーブルの存在を確認する。無ければ warn を出して false を返す。
 * @returns テーブルが引けたら true (適用済み)、不在 / DB 不達なら false。
 */
export async function checkMigrations({ query, warn }: MigrationCheckDeps): Promise<boolean> {
  try {
    await query(`SELECT 1 FROM ${CORE_TABLE} LIMIT 1`);
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === '42P01') {
      // undefined_table: migration 未適用が確定
      warn(`[migration-check] ${CORE_TABLE} テーブルが見つかりません — cd server && npm run migrate を実行してください`);
      // ★ #406: 既に他のテーブルが在る DB では、runner が止まって baseline を案内する。
      //   そちらの手順も先に出しておく (「案内どおり打ったら失敗した」を作らない)。
      warn(`[migration-check]   ★ 既存の DB で「schema_migrations が無い」と止まった場合は npm run migrate -- --baseline`);
      warn(`[migration-check]   辞書育成タブ (admin) が 500 になり、自己成長辞書 (#327) が動作しません。稼働は継続します (file フォールバック)。`);
    } else {
      // DB 不達など: テーブルの有無を断定できないが、setup 中の可能性があるので surface する
      const msg = err instanceof Error ? err.message : String(err);
      warn(`[migration-check] ${CORE_TABLE} の確認に失敗しました (DB 不達?): ${msg}`);
    }
    return false;
  }
}
