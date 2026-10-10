/**
 * Migration runner (#406 で台帳を導入)
 *
 * ★★★★ **かつては台帳が無く、毎回すべてのファイルを先頭から流し直していた。**
 *   そのため `008_stamps.sql` が `form` を知らない CHECK 制約を張り直そうとして、
 *   026 以降に作られた form 型のメッセージに弾かれ、**本番 DB に migrate を流せなかった**
 *   (2026-09-05 に #405 の列を足そうとして踏み、027 は手で当てた)。
 *
 * ★★ **空の DB では再現しない** (順に流れて最後に 026 が勝つ)。テストも毎回 drop してから
 *   流していたので、**再生の経路は一度も通っていなかった**。だから長く気づけなかった。
 *
 * 直し方: `schema_migrations` に適用済みのファイル名を記録し、**未適用だけ**を流す。
 *
 * ★ 既存 DB の初期投入は **推測しない**。台帳が無いのにテーブルが在る DB は
 *   「全部適用済み」か「途中まで」か**区別が付かない**ので、止めて人に決めさせる:
 *     npm run migrate -- --baseline    ← 全ファイルを「適用済み」として記録するだけ (流さない)
 *
 * ★★ #500: 上限なしの baseline は **最新まで当ててある DB でしか正しくない**。v0.9.0 の DB は
 *   026 までなので、027 以降が流れないまま適用済みになる。上限を付けられるようにした:
 *     npm run migrate -- --baseline-through 026_message_form_type.sql   ← そこまでを記録。残りは次の通常実行で流れる
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

const LEDGER = 'schema_migrations';

// ★ 純粋な判断は pg を import しないファイルに置く (#406 / 2026-09-19)。
//   agent-server 側はそちらを直接 import すること (ここを経由すると pg まで要求される)。
import { planMigrations, needsBaseline, baselineTargets } from './migrationPlan.mts';
export { planMigrations, needsBaseline, baselineTargets };

function listMigrationFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

async function hasLedgerTable(client: pg.PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`, [LEDGER]);
  return Number(rows[0].n) > 0;
}

async function hasUserTables(client: pg.PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> $1`, [LEDGER]);
  return Number(rows[0].n) > 0;
}

export interface MigrateOptions {
  /** 全ファイルを「適用済み」として記録するだけ (流さない)。既存 DB の初期投入用 */
  baseline?: boolean;
  /** #500 このファイルまでを「適用済み」として記録するだけ (流さない)。v0.9.0 からの更新用 */
  baselineThrough?: string;
  log?: (message: string) => void;
}

export async function migrate(config?: pg.PoolConfig, opts: MigrateOptions = {}): Promise<void> {
  const log = opts.log || ((m: string) => console.log(m));
  const pool = new pg.Pool(config || {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'tealus',
    user: process.env.DB_USER || 'tealus',
    password: process.env.DB_PASSWORD || 'tealus_dev',
  });

  const migrationsDir = path.join(import.meta.dirname, 'migrations');
  const files = listMigrationFiles(migrationsDir);

  const client = await pool.connect();
  try {
    const ledgerExists = await hasLedgerTable(client);
    const baselining = Boolean(opts.baseline || opts.baselineThrough);

    // ★ 推測しない。台帳が無いのにテーブルが在るなら、ここで止めて人に決めさせる
    if (!baselining && needsBaseline(ledgerExists, await hasUserTables(client))) {
      throw new Error(
        `${LEDGER} が無いのに、既にテーブルが存在します。どこまで適用済みか判定できません。\n`
        + `  v0.9.0 以前から上げるなら:  npm run migrate -- --baseline-through 026_message_form_type.sql\n`
        + `                              (026 までを「適用済み」と記録。続けて npm run migrate で 027 以降が流れます)\n`
        + `  最新まで当ててある DB なら:  npm run migrate -- --baseline   (全ファイルを「適用済み」として記録するだけ)\n`
        // ★ #557 2026-10-10 より前の docker-compose.yml は Postgres の初回起動で migrations を流し、台帳を作らなかった
        + `  Docker の初回起動で migrations を流して作った DB なら (10-10 より前の docker-compose.yml):\n`
        + `                              作ってから git pull していなければ  npm run migrate -- --baseline\n`
        + `                              pull していたら、作ったときの最後のファイル名で  npm run migrate -- --baseline-through <ファイル名>\n`
        + `  作り直すなら:                DB を空にしてから npm run migrate`,
      );
    }

    // ★ #500 上限の名前は、台帳を作る前に確かめる (打ち間違いで何かを記録しない)
    if (opts.baselineThrough !== undefined) baselineTargets(files, new Set(), opts.baselineThrough);

    await client.query(
      `CREATE TABLE IF NOT EXISTS ${LEDGER} (
         filename   text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`);

    const { rows } = await client.query<{ filename: string }>(`SELECT filename FROM ${LEDGER}`);
    const applied = new Set(rows.map((r) => r.filename));
    const pending = planMigrations(files, applied);

    if (baselining) {
      const targets = baselineTargets(files, applied, opts.baselineThrough);
      for (const file of targets) {
        await client.query(`INSERT INTO ${LEDGER} (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
      }
      log(`baseline: ${targets.length} 件を「適用済み」として記録しました (実行はしていません)`);
      const rest = pending.length - targets.length;
      if (rest > 0) log(`  残り ${rest} 件は、続けて npm run migrate で流れます`);
      return;
    }

    if (pending.length === 0) {
      log('適用済みです (未適用の migration はありません)');
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      log(`Running migration: ${file}`);
      // ★ 1 ファイル = 1 トランザクション。途中で落ちたものを「適用済み」に記録しない
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${LEDGER} (filename) VALUES ($1)`, [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      log(`  Done: ${file}`);
    }
    log(`${pending.length} 件の migration を適用しました。`);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run directly
if (import.meta.main) {
  dotenv.config();
  const baseline = process.argv.includes('--baseline');
  // #500 --baseline-through <name> / --baseline-through=<name>
  const i = process.argv.findIndex((a) => a === '--baseline-through' || a.startsWith('--baseline-through='));
  const arg = i < 0 ? undefined : process.argv[i];
  const baselineThrough = arg === undefined ? undefined
    : arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : process.argv[i + 1];
  if (arg !== undefined && !baselineThrough) {
    console.error('Migration failed: --baseline-through にはファイル名が要ります (例: 026_message_form_type.sql)');
    process.exit(1);
  }
  migrate(undefined, { baseline, baselineThrough }).catch(err => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
