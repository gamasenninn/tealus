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
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

const LEDGER = 'schema_migrations';

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

    // ★ 推測しない。台帳が無いのにテーブルが在るなら、ここで止めて人に決めさせる
    if (!opts.baseline && needsBaseline(ledgerExists, await hasUserTables(client))) {
      throw new Error(
        `${LEDGER} が無いのに、既にテーブルが存在します。どこまで適用済みか判定できません。\n`
        + `  既存の DB なら:  npm run migrate -- --baseline   (全ファイルを「適用済み」として記録するだけ)\n`
        + `  作り直すなら:    DB を空にしてから npm run migrate`,
      );
    }

    await client.query(
      `CREATE TABLE IF NOT EXISTS ${LEDGER} (
         filename   text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`);

    const { rows } = await client.query<{ filename: string }>(`SELECT filename FROM ${LEDGER}`);
    const applied = new Set(rows.map((r) => r.filename));
    const pending = planMigrations(files, applied);

    if (opts.baseline) {
      for (const file of pending) {
        await client.query(`INSERT INTO ${LEDGER} (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
      }
      log(`baseline: ${pending.length} 件を「適用済み」として記録しました (実行はしていません)`);
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
  migrate(undefined, { baseline }).catch(err => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
