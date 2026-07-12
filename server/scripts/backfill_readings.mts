/**
 * #327 dictionary_terms.reading を pykakasi で自動 backfill する（読み供給の自動側）。
 *
 * reading が NULL/空 の term だけ更新（手動で入れた読みは消さない = 設計の「自動生成＋手動修正」）。
 * 読み変換は _readings_pykakasi.py に stdin/stdout で委譲（`uv run`）。DB は .env の接続先。
 *
 * 使い方: node scripts/backfill_readings.mts
 *   テスト時は DB_* を test に export して実行。
 */
import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pool } from '../src/db/pool.mts';

dotenv.config();

interface TermRow {
  id: string;
  term: string;
}

export interface BackfillResult {
  updated: number;
  total: number;
}

export async function backfill(): Promise<BackfillResult> {
  const { rows } = await pool.query<TermRow>(
    "SELECT id, term FROM dictionary_terms WHERE reading IS NULL OR reading = ''",
  );
  if (!rows.length) return { updated: 0, total: 0 };

  const terms = rows.map((r) => r.term);
  const py = path.join(import.meta.dirname, '_readings_pykakasi.py');
  const res = spawnSync('uv', ['run', py], {
    input: JSON.stringify(terms),
    encoding: 'utf-8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`pykakasi failed (status ${res.status}): ${res.stderr || res.error}`);
  }
  const map: Record<string, string> = JSON.parse(res.stdout);

  let updated = 0;
  for (const r of rows) {
    const reading = map[r.term];
    if (!reading) continue;
    const u = await pool.query(
      "UPDATE dictionary_terms SET reading = $2, updated_at = NOW() WHERE id = $1 AND (reading IS NULL OR reading = '')",
      [r.id, reading],
    );
    if (u.rowCount) updated += 1;
  }
  return { updated, total: rows.length };
}

if (import.meta.main) {
  backfill()
    .then(({ updated, total }) => {
      console.log(`backfilled readings: ${updated}/${total} terms (reading IS NULL only)`);
      return pool.end();
    })
    .catch((err: unknown) => {
      console.error('backfill failed:', err instanceof Error ? err.message : String(err));
      pool.end();
      process.exit(1);
    });
}
