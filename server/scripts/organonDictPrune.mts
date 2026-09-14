/**
 * #381 organon 由来 alias の掃除 (prune) / #384 語 (term) の撤去。
 *
 * `sync_organon_dict.mts` は upsert しかしない (撤去を持たない) ため、
 * **射影を絞っても DB は収束しない**。落とした行は明示的に落とす必要がある。
 * その「落としてよい行」を決めるのがこのモジュール。
 *
 * ★ 2026-09-14、alias も **削除から tombstone に変えた** (term と揃えた)。理由は
 *   「なぜ消したかが残る」だけではない —— organon からは auto / manual が原理的に見えず、
 *   DELETE だと自己成長辞書が同じ文字列を入れた瞬間に organon の**判断**が消える
 *   (§6.2.4「撤去漏れの害は『古い語が残る』ではなく『保留の判断が勝手に確定される』」)。
 *
 * ★ 絞りは **alias 自身の `source`** で行う。用語 (`dictionary_terms.source`) ではない。
 *   2026-08-27、手書き SQL で用語側の source で絞ってしまい、organon 由来の用語に
 *   ぶら下がる auto / manual の alias 53 件を巻き添えで消した (バックアップから復元)。
 *   auto = 自己成長辞書が現場の音声から学習した揺れ / manual = 人が足した揺れで、
 *   **どちらも射影には出てこない**。出所で絞らないと必ず巻き込む。
 *
 * 使い方 (既定は dry-run = DB を書き換えない):
 *   ORGANON_TTL_PATH=... node scripts/organonDictPrune.mts            ← 差分を数えるだけ
 *   ORGANON_TTL_PATH=... node scripts/organonDictPrune.mts --apply    ← 実際に落とす
 *
 * ★ dry-run は「ズレの検知器」でもある。DB の organon alias 数が射影より多ければ、
 *   **畳み込みが効いていない状態で pull が回っている** (= サーバが古いコードを掴んだまま)。
 *   2026-08-25〜27 の 2 日間、まさにそれに気づけずに測定していた。
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { pool } from '../src/db/pool.mts';
import { projectOrganonDict, type ProjectedTerm } from './organonDictProjection.mts';
import {
  planRetraction,
  selectStaleTerms,
  staleCutoff,
  DEFAULT_STALE_PULLS,
  type ActiveTermRow,
} from './organonRetractionGuard.mts';

dotenv.config();

const TTL_PATH = process.env.ORGANON_TTL_PATH || '';

export interface AliasRow {
  term: string;
  alias: string;
  source: string;
  /** ★ 省略時は active 扱い。既に tombstone 済みの行を二度対象にしないため (#384)。 */
  status?: string;
  id?: string;
}

/** organon が入れた alias だけが掃除の対象。他の出所は射影に載らないので触らない。 */
const PRUNABLE_SOURCE = 'organon';

/**
 * 現在の alias 行のうち、射影に含まれないものを返す (= 撤去してよい行)。
 * 判定は (term, alias) の組で行う。同じ alias 文字列でも用語が違えば別扱い。
 */
export function selectPrunableAliases(projected: ProjectedTerm[], rows: AliasRow[]): AliasRow[] {
  // 区切りは alias に現れない文字にする (term と alias の境目が動くと判定がずれる)
  const key = (term: string, alias: string): string => JSON.stringify([term, alias]);
  const keep = new Set<string>();
  for (const p of projected) {
    for (const a of p.aliases) keep.add(key(p.term, a));
  }
  return rows.filter(
    (r) =>
      r.source === PRUNABLE_SOURCE &&
      // ★ 既に tombstone 済みは対象外 (#384)。撤去を DELETE から tombstone に変えると
      //   落とした行が DB に残るので、status を見ないと同じ行を毎回数え続けて収束しない。
      //   件数の上限を、済んだ分だけで食い潰すことにもなる。
      (r.status ?? 'active') !== 'rejected' &&
      !keep.has(key(r.term, r.alias)),
  );
}

/**
 * DB 上で active な organon 由来の語を読む (#384)。
 * ★ alias と違い、語は **削除ではなく tombstone** (status='rejected')。
 *   `upsertTerm` の guard が rejected を尊重するので次の取り込みで復活しない (#375)。
 */
async function loadActiveOrganonTerms(): Promise<(ActiveTermRow & { id: string })[]> {
  const { rows } = await pool.query<{ id: string; term: string; source: string; updated_at: Date }>(
    `SELECT id, term, source, updated_at
       FROM dictionary_terms
      WHERE source = 'organon' AND status = 'active'`
  );
  return rows.map((r) => ({ id: r.id, term: r.term, source: r.source, updatedAt: r.updated_at }));
}

/**
 * pull の実行時刻を新しい順に読む (#384)。★ 撤去の基準線は「K 回前の pull」。
 *
 * ★★ ここが空 / 足りない = **判定材料が無い**。呼び出し側はそのとき撤去しない。
 *   記録漏れは「消しすぎ」ではなく「消さなすぎ」に倒れる。
 */
async function loadSyncRuns(limit: number): Promise<Date[]> {
  const { rows } = await pool.query<{ ran_at: Date }>(
    `SELECT ran_at FROM organon_sync_runs ORDER BY ran_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.ran_at);
}

/** DB 上の alias 行 (出所つき) を全部読む。判定は呼び出し側 = selectPrunableAliases。 */
async function loadAliasRows(): Promise<AliasRow[]> {
  const { rows } = await pool.query<AliasRow>(
    `SELECT a.id, t.term, a.alias, a.source, a.status
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
      console.log(`撤去対象  ${prunable.length} 行 (★ tombstone。削除しない)`);

      // ★ #384 語 (term) の撤去。alias と違い tombstone (削除しない)。
      const termRows = await loadActiveOrganonTerms();
      const runs = await loadSyncRuns(DEFAULT_STALE_PULLS);
      const cutoff = staleCutoff(runs, DEFAULT_STALE_PULLS);
      // ★ 記録が K 回に満たなければ撤去しない。**不在が続いたことを証明できないものは消さない。**
      const stale = cutoff ? selectStaleTerms(projected.map((p) => p.term), termRows, cutoff) : [];
      const staleWithId = stale as (ActiveTermRow & { id: string })[];
      console.log(
        `\n語(term)  DB の organon active ${termRows.length} 件 / pull の記録 ${runs.length} 件`
      );
      if (!cutoff) {
        console.log(
          `          ★ pull の記録が ${DEFAULT_STALE_PULLS} 回に満たないので撤去しない ` +
          `(★★ 不在が ${DEFAULT_STALE_PULLS} 回続いたことを証明できない)`
        );
      } else {
        console.log(
          `          基準線 = ${DEFAULT_STALE_PULLS} 回前の pull ` +
          `${cutoff.toISOString().slice(0, 16).replace('T', ' ')} / ` +
          `それより前で止まっているもの ${stale.length} 件`
        );
      }
      for (const r of staleWithId) {
        console.log(`  - ${r.term}  最終更新 ${r.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}`);
      }

      // ★ 歯止め。alias / term それぞれの母数で判定する (#384、organon 班の Day 52 指摘)。
      const aliasPlan = planRetraction({
        projectedCount: projectedAliases,
        dbActiveCount: organonRows.length,
        victimCount: prunable.length,
      });
      const termPlan = planRetraction({
        projectedCount: projected.length,
        dbActiveCount: termRows.length,
        victimCount: stale.length,
      });
      console.log(`\n歯止め    alias: ${aliasPlan.action} — ${aliasPlan.reason}`);
      console.log(`          term : ${termPlan.action} — ${termPlan.reason}`);

      if (!apply) {
        if (prunable.length > 0) {
          console.log('\n★ DB が射影より多い = 畳み込みが効いていない pull が回っている可能性。');
          console.log('  サーバの起動時刻と射影の更新時刻を比べること (古いコードのままなら再起動が先)。');
        }
        if (prunable.length > 0 || stale.length > 0) {
          console.log('  ★ 書き込みには --apply が要る (既定は dry-run)。');
        }
      }

      if (apply && aliasPlan.action === 'apply') {
        // ★ #384 削除ではなく tombstone。理由は「なぜ消したかが残る」だけではない ——
        //   organon から **auto / manual は原理的に見えない** (2026-09-01 実測で
        //   organon 555 / manual 83 / auto 51)。organon が alias を外すのは掃除ではなく
        //   **判断**で、「どちらに寄せるか決められない」という保留の宣言であることがある。
        //   DELETE だと、自己成長辞書 (auto) が同じ文字列を入れた瞬間にその判断が消える。
        //   しかも organon からは入ったことが見えないので、**外したつもりのまま静かに戻る**。
        //   = §6.2.4 の「撤去漏れの害は『古い語が残る』ではなく『保留の判断が勝手に確定される』」。
        //   ★ upsertAlias は rejected を尊重して no-op なので、tombstone なら供給元をまたいで効く。
        const res = await pool.query(
          `UPDATE dictionary_aliases a
              SET status = 'rejected'
             FROM dictionary_terms t
            WHERE t.id = a.term_id
              AND a.source = 'organon'
              AND a.status <> 'rejected'
              AND (t.term, a.alias) NOT IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
          [projected.flatMap((p) => p.aliases.map(() => p.term)), projected.flatMap((p) => p.aliases)]
        );
        console.log(`alias tombstone しました: ${res.rowCount} 行 (★ 削除ではない)`);
      }
      if (apply && termPlan.action === 'apply') {
        for (const r of staleWithId) {
          await pool.query(
            `UPDATE dictionary_terms SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
            [r.id]
          );
          console.log(`term tombstone: ${r.term}`);
        }
        // ★ 行を書き換えただけでは在庫の語彙は入れ替わらない。refreshVocabFromTable を
        //   呼ばないと「直したのに効いていない」が次の再起動まで続く (2026-09-14 に踏みかけた)。
        console.log('★ 語彙の在庫を入れ替えるには、サーバ側で refreshVocabFromTable が要る');
        console.log('  (管理画面で語を 1 つ操作するか、サーバを再起動すると走る)');
      }
      if (apply && (aliasPlan.action === 'skip' || termPlan.action === 'skip')) {
        console.log('\n★★ 歯止めに当たったため、その分は書き込んでいません。');
      }
      await pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
