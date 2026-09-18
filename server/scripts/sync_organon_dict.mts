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
import { buildPullState, writePullState } from '../src/services/organonPullState.mts';

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
  // ★ #384 pull が走ったことを残す。撤去の条件「K 回続けて射影に無い」を判定するには
  //   **pull がいつ走ったか**が要る。updated_at の古さで代用すると、pull が止まっていた
  //   期間まで「不在」に数えてしまう (= 1 回の不在で落ちる)。
  //   ★ 記録に失敗しても sync は落とさない。撤去は「記録が K 回に満たなければ何もしない」
  //     側に倒れるので、記録漏れは **消しすぎではなく消さなすぎ**に出る。
  try {
    await pool.query(
      'INSERT INTO organon_sync_runs (terms, aliases, ttl_path) VALUES ($1, $2, $3)',
      [terms, aliases, ttlPath]
    );
  } catch (err) {
    console.warn(`[organon] sync run の記録に失敗 (sync は成功しています): ${String(err)}`);
  }
  // ★ #384 引ける口。organon 班は通知を受け取れないことがあるので、毎日 Step 5 のときに
  //   自分で引ける形を 1 つ置く (= 通知と口の両方が落ちて初めて見えなくなる)。
  // ★★ 2026-09-15 追加: DB 側の実数も一緒に置く。向こうは DB を引けないので、
  //   生の数字ではなく **射影との差 (drift)** にして初めて 1 file で読める
  //   (組み立ては buildPullState 側)。★★★ 引けなければ null —— 0 と書かない。
  let dbOrganonActiveTerms: number | null = null;
  try {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM dictionary_terms WHERE source = 'organon' AND status = 'active'"
    );
    dbOrganonActiveTerms = Number(rows[0].n);
  } catch (err) {
    // ★ 黙らない。null のまま書くと「引けなかった」が残るが、理由はログにしか無い。
    console.warn(`[organon] DB の active 語数を引けませんでした (sync は成功しています): ${String(err)}`);
  }
  // ★ 2026-09-18 別名側 (organon 班の依頼)。★★ 語と同じ引き算にしないこと ——
  //   `source` は「今の供給元」ではなく **「最初に入れた側」**を記録する (upsertAlias が
  //   source を上書きしないため)。射影 614 に対し organon 由来 active は 607 で、
  //   差 -7 は tombstone 1 + 先に別の出所が入った 6 = すべて正常。
  //   ★★★ なので出すのは「射影から外れたのに残っている数」(= 撤去の積み残し、正常は 0)。
  let dbOrganonActiveAliases: number | null = null;
  let aliasesNotInProjection: number | null = null;
  let aliasesHeldByOtherSource: number | null = null;
  try {
    // ★ 語が active な行だけを見る。在庫 (local.ttl) も active な語しか書き出さないので、
    //   ここで語の status を外すと 落とした語の別名まで数えて 恒常的にずれる。
    const { rows } = await pool.query<{ term: string; alias: string; source: string }>(
      `SELECT t.term, a.alias, a.source
         FROM dictionary_aliases a JOIN dictionary_terms t ON t.id = a.term_id
        WHERE a.status = 'active' AND t.status = 'active'`
    );
    // ★ 区切りは alias に現れない文字にする (organonDictPrune の key と同じ形)
    const key = (t: string, a: string): string => JSON.stringify([t, a]);
    const projectedPairs = new Set<string>();
    for (const p of projected) for (const a of p.aliases) projectedPairs.add(key(p.term, a));
    const organonActive = new Set<string>();
    for (const r of rows) if (r.source === 'organon') organonActive.add(key(r.term, r.alias));
    dbOrganonActiveAliases = organonActive.size;
    aliasesNotInProjection = [...organonActive].filter((k) => !projectedPairs.has(k)).length;
    aliasesHeldByOtherSource = [...projectedPairs].filter((k) => !organonActive.has(k)).length;
  } catch (err) {
    console.warn(`[organon] DB の active 別名を引けませんでした (sync は成功しています): ${String(err)}`);
  }
  writePullState(
    buildPullState({
      ranAt: new Date(), terms, aliases, ttlPath, dbOrganonActiveTerms,
      dbOrganonActiveAliases, aliasesNotInProjection, aliasesHeldByOtherSource,
    })
  );
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
