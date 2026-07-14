/**
 * #331 organon dock sync ツール: organon.ttl (公開 RDF 契約) → 辞書テーブルへ pull-import。
 *
 * 旧 seed_dictionary.mts (guideline.json 経由、#331 で retire 済) の後継。organon が publish した RDF を
 * mirror 経由で読み、proper noun (Role→person / Organization→vendor|organization) を
 * dictionary_terms/aliases に upsert(source='organon')。冪等。
 *
 * product/place/term 等の汎用・別種語彙は organon の責務外 = 本ツールは扱わない (base/manual に残す)。
 *
 * 使い方:
 *   ORGANON_TTL_PATH=/path/to/tealus-organon/tools/organon.ttl node scripts/sync_organon_dict.mts
 *   --dry-run を付けると射影のみ表示 (DB 非接触)。
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import * as repo from '../src/services/dictionaryRepo.mts';
import { pool } from '../src/db/pool.mts';
import { projectOrganonDict, type ProjectedTerm } from './organonDictProjection.mts';

dotenv.config();

const TTL_PATH = process.env.ORGANON_TTL_PATH || '';

export interface SyncResult {
  terms: number;
  aliases: number;
}

/** 射影結果を dictionary テーブルへ upsert (source='organon')。冪等。 */
export async function syncFromOrganon(ttlPath: string): Promise<SyncResult> {
  const projected = projectOrganonDict(fs.readFileSync(ttlPath, 'utf8'));
  let terms = 0;
  let aliases = 0;
  for (const p of projected) {
    const t = await repo.upsertTerm({ term: p.term, category: p.category, source: 'organon' });
    terms += 1;
    for (const alias of p.aliases) {
      await repo.upsertAlias({ termId: t.id, alias, source: 'organon', count: 0 });
      aliases += 1;
    }
  }
  return { terms, aliases };
}

function summarize(projected: ProjectedTerm[]) {
  const byCat: Record<string, number> = {};
  let aliasN = 0;
  for (const p of projected) {
    byCat[p.category] = (byCat[p.category] || 0) + 1;
    aliasN += p.aliases.length;
  }
  return { terms: projected.length, aliases: aliasN, byCat };
}

if (import.meta.main) {
  if (!TTL_PATH) {
    console.error('ORGANON_TTL_PATH env が必要 (organon repo mirror の tools/organon.ttl を指す)');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    // DB 非接触: 射影だけ計算して表示
    const projected = projectOrganonDict(fs.readFileSync(TTL_PATH, 'utf8'));
    const s = summarize(projected);
    console.log(`[dry-run] ${TTL_PATH}\n  → ${s.terms} terms / ${s.aliases} aliases (source=organon 予定、書き込みなし)`);
    console.log(`  category: ${JSON.stringify(s.byCat)}`);
    console.log(`  sample: ${projected.slice(0, 3).map((p) => `${p.term}[${p.category}](${p.aliases.length}a)`).join(' / ')}`);
    process.exit(0);
  }
  syncFromOrganon(TTL_PATH)
    .then(({ terms, aliases }) => {
      console.log(`synced: ${terms} terms / ${aliases} aliases (source=organon) from ${TTL_PATH}`);
      return pool.end();
    })
    .catch((err: unknown) => {
      console.error('sync failed:', err instanceof Error ? err.message : String(err));
      pool.end();
      process.exit(1);
    });
}
