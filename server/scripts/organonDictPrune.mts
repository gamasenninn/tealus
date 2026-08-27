/**
 * #381 organon 由来 alias の掃除 (prune)。
 *
 * `sync_organon_dict.mts` は upsert しかしない (DELETE を持たない) ため、
 * **射影を絞っても DB は収束しない**。落とした行は明示的に消す必要がある。
 * その「消してよい行」を決めるのがこのモジュール。
 *
 * ★ 絞りは **alias 自身の `source`** で行う。用語 (`dictionary_terms.source`) ではない。
 *   2026-08-27、手書き SQL で用語側の source で絞ってしまい、organon 由来の用語に
 *   ぶら下がる auto / manual の alias 53 件を巻き添えで消した (バックアップから復元)。
 *   auto = 自己成長辞書が現場の音声から学習した揺れ / manual = 人が足した揺れで、
 *   **どちらも射影には出てこない**。出所で絞らないと必ず巻き込む。
 *
 * 使い方 (既定は dry-run = DB を書き換えない):
 *   ORGANON_TTL_PATH=... node scripts/organonDictPrune.mts            ← 差分を数えるだけ
 *   ORGANON_TTL_PATH=... node scripts/organonDictPrune.mts --apply    ← 実際に消す
 *
 * ★ dry-run は「ズレの検知器」でもある。DB の organon alias 数が射影より多ければ、
 *   **畳み込みが効いていない状態で pull が回っている** (= サーバが古いコードを掴んだまま)。
 *   2026-08-25〜27 の 2 日間、まさにそれに気づけずに測定していた。
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { pool } from '../src/db/pool.mts';
import { projectOrganonDict, type ProjectedTerm } from './organonDictProjection.mts';

dotenv.config();

const TTL_PATH = process.env.ORGANON_TTL_PATH || '';

export interface AliasRow {
  term: string;
  alias: string;
  source: string;
}

/** organon が入れた alias だけが掃除の対象。他の出所は射影に載らないので触らない。 */
const PRUNABLE_SOURCE = 'organon';

/**
 * 現在の alias 行のうち、射影に含まれないものを返す (= 削除してよい行)。
 * 判定は (term, alias) の組で行う。同じ alias 文字列でも用語が違えば別扱い。
 */
export function selectPrunableAliases(projected: ProjectedTerm[], rows: AliasRow[]): AliasRow[] {
  // 区切りは alias に現れない文字にする (term と alias の境目が動くと判定がずれる)
  const key = (term: string, alias: string): string => JSON.stringify([term, alias]);
  const keep = new Set<string>();
  for (const p of projected) {
    for (const a of p.aliases) keep.add(key(p.term, a));
  }
  return rows.filter((r) => r.source === PRUNABLE_SOURCE && !keep.has(key(r.term, r.alias)));
}

/** DB 上の alias 行 (出所つき) を全部読む。判定は呼び出し側 = selectPrunableAliases。 */
async function loadAliasRows(): Promise<AliasRow[]> {
  const { rows } = await pool.query<AliasRow>(
    `SELECT t.term, a.alias, a.source
       FROM dictionary_aliases a
       JOIN dictionary_terms t ON t.id = a.term_id`
  );
  return rows;
}

if (import.meta.main) {
  if (!TTL_PATH) {
    console.error('ORGANON_TTL_PATH env が必要 (organon repo mirror の tools/organon.ttl を指す)');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const projected = projectOrganonDict(fs.readFileSync(TTL_PATH, 'utf8'));
  const projectedAliases = projected.reduce((n, p) => n + p.aliases.length, 0);

  loadAliasRows()
    .then(async (rows) => {
      const organonRows = rows.filter((r) => r.source === 'organon');
      const prunable = selectPrunableAliases(projected, rows);
      console.log(`射影      ${projected.length} terms / ${projectedAliases} aliases`);
      console.log(
        `DB        organon alias ${organonRows.length} 行 (他の出所 ${rows.length - organonRows.length} 行は対象外)`
      );
      console.log(`削除対象  ${prunable.length} 行`);
      if (prunable.length > 0 && !apply) {
        console.log('\n★ DB が射影より多い = 畳み込みが効いていない pull が回っている可能性。');
        console.log('  サーバの起動時刻と射影の更新時刻を比べること (古いコードのままなら再起動が先)。');
        console.log('  消してよいなら --apply を付けて再実行。');
      }
      if (apply && prunable.length > 0) {
        const res = await pool.query(
          `DELETE FROM dictionary_aliases a
             USING dictionary_terms t
            WHERE t.id = a.term_id
              AND a.source = 'organon'
              AND (t.term, a.alias) NOT IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
          [projected.flatMap((p) => p.aliases.map(() => p.term)), projected.flatMap((p) => p.aliases)]
        );
        console.log(`削除しました: ${res.rowCount} 行`);
      }
      await pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
