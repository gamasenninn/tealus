/**
 * #442 doctor 第 2 版 — **読み取り**の側。★ 判定は `doctor.mts` の純関数に置く。
 *
 * ★★★ **この module は起動時に読み込まれない。** `scripts/doctor.mts` (手動の口) からだけ import する。
 *   ESM の import は巻き上がるので、`doctor.mts` 側に `pg` / `openai` を書くと
 *   **起動時に必ず載る** (= <200ms の約束が静かに崩れる)。分けているのはそのため。
 *
 * ★ 作らないもの (#442 の「作らないもの」をそのまま継ぐ):
 *   - 定期実行しない。起動時と手動の 2 つだけ
 *   - 自動で直さない (env も DB も書き換えない)
 *   - 疎通の結果をキャッシュしない (★★ 「いつの結果か」が曖昧になる)
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import OpenAI from 'openai';
import {
  judgeMigrations,
  judgeOverlayDrift,
  judgeProbe,
  type DoctorEnv,
  type Finding,
  type ProbeResult,
} from './doctor.mts';
// ★ migrate.mts ではなく migrationPlan.mts を見る —— 前者は pg を import するので
//   agent-server の型検査が server の依存を要求し、CI だけ落ちる (2026-09-19)
import { planMigrations } from '../../../server/src/db/migrationPlan.mts';
import { loadVocabEntriesFromTtl } from './vocabContext.mts';

const SERVER_DB_DIR = path.resolve(import.meta.dirname, '../../../server/src/db');

/** ★ 診断のためだけの短命な接続。★★ 本体のプールは使わない (別プロセスなので掴めない)。 */
async function withClient<T>(env: DoctorEnv, fn: (c: pg.Client) => Promise<T>): Promise<T | null> {
  const client = new pg.Client({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || 'tealus',
    // ★ 既定は本体の pool.mts と揃える。★★ ずらすと「DB が落ちている」と誤診する
    password: env.DB_PASSWORD || 'tealus_dev',
    database: env.DB_NAME || 'tealus',
  });
  try {
    await client.connect();
    return await fn(client);
  } catch {
    return null; // ★ 引けなかった。★★ 判定側が「0 件」と区別する
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * #442 (1) migration の適用状態 + (3) 辞書オーバーレイの掛け違い。
 * ★ どちらも DB を 1 回ずつ引くだけ。★★ 書き込まない。
 */
export async function runDbChecks(env: DoctorEnv): Promise<Finding[]> {
  const out: Finding[] = [];

  // (1) ★ 台帳を読むだけ。★★ planMigrations は作り直さず server 側のものを使う
  const mig = await withClient(env, async (c) => {
    const { rows } = await c.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations'
    );
    return new Set(rows.map((r) => r.filename));
  });
  if (mig === null) {
    out.push(judgeMigrations(null, null));
  } else {
    const files = fs
      .readdirSync(path.join(SERVER_DB_DIR, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    out.push(judgeMigrations(planMigrations(files, mig), mig.size));
  }

  // (3) ★ DB の active な語/別名 vs 在庫 (agent-server が実際に読む local.ttl)
  //   ★★ 2026-09-18 に別名を足した。語だけでは、organon の撤去も自己成長辞書の昇格も
  //   **主に別名を動かす**ので、掛け違いが件数に出ない (同日に実例が 1 件あった)。
  const dbCounts = await withClient(env, async (c) => {
    const terms = await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM dictionary_terms WHERE status = 'active'"
    );
    // ★ active な語に属する別名だけを数える。local.ttl は active な語しか書き出さないので、
    //   ここで語の status を見ないと **落とした語の別名まで数えて 恒常的にずれる**。
    const aliases = await c.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM dictionary_aliases a JOIN dictionary_terms t ON t.id = a.term_id
        WHERE a.status = 'active' AND t.status = 'active'`
    );
    return { terms: Number(terms.rows[0].n), aliases: Number(aliases.rows[0].n) };
  });
  let overlayTerms: number | null = null;
  let overlayAliases: number | null = null;
  try {
    const entries = loadVocabEntriesFromTtl();
    // ★ 0 件は「ファイルが無い / parse 失敗」でも返る (loadVocabEntriesFromTtl は throw しない)。
    //   ★★ 「在庫 0」と「引けなかった」を同じにしないため、0 は null に倒す。
    if (entries.length > 0) {
      overlayTerms = entries.length;
      overlayAliases = entries.reduce((s, e) => s + (e.aliases?.length ?? 0), 0);
    }
  } catch {
    overlayTerms = null;
    overlayAliases = null;
  }
  out.push(
    judgeOverlayDrift({
      dbTerms: dbCounts?.terms ?? null,
      overlayTerms,
      dbAliases: dbCounts?.aliases ?? null,
      overlayAliases,
    })
  );

  return out;
}

/** 経路 → モデル env。★ `doctor.mts` の ROUTE_MODELS と同じ 3 経路を見る。 */
const PROBE_ROUTES: Array<{ route: string; key: string; usesApiKey: (env: DoctorEnv) => boolean }> = [
  {
    route: 'Light',
    key: 'AGENT_LIGHT_MODEL',
    usesApiKey: (e) => (e.AGENT_LIGHT_BACKEND === 'v2' ? e.LIGHTV2_AUTH !== 'subscription' : true),
  },
  { route: 'Router', key: 'AGENT_ROUTER_MODEL', usesApiKey: () => true },
  {
    route: 'Deep',
    key: 'AGENT_DEEP_CODEX_MODEL',
    usesApiKey: (e) => e.DEEP_CODEX_AUTH !== 'subscription',
  },
];

/**
 * #442 (4) 外部疎通。★ **既定では呼ばれない** (`npm run doctor -- --probe`)。
 *
 * ★★ 叩くのは `models.list` だけ。★★★ **トークンを消費しない**ので、診断のために
 *   課金が出ることはない (完了 API を叩くと「診断のたびに金を払う」形になり、
 *   結局 誰も叩かなくなる)。
 * ★ codex(subscription) 経由の経路は **API 鍵では原理的に確かめられない**ので `not-probed`。
 *   ★★ これを「失敗」と書くと、第 1 版が踏んだ誤診 (#431) を別の形で再演する。
 */
export async function runProbeChecks(env: DoctorEnv): Promise<Finding[]> {
  const results: ProbeResult[] = [];
  let available: Set<string> | null = null;
  let listErr = '';

  const needsApi = PROBE_ROUTES.some((r) => r.usesApiKey(env));
  if (needsApi && env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const list = await client.models.list();
      available = new Set(list.data.map((m) => m.id));
    } catch (err) {
      listErr = err instanceof Error ? err.message : String(err);
    }
  }

  for (const r of PROBE_ROUTES) {
    const model = env[r.key] || '(未設定)';
    if (!r.usesApiKey(env)) {
      results.push({
        route: r.route,
        model,
        via: 'codex(subscription)',
        status: 'not-probed',
        note: '★ API 鍵では確かめられません (ChatGPT アカウント経由)',
      });
      continue;
    }
    if (available === null) {
      results.push({
        route: r.route,
        model,
        via: 'OpenAI API',
        status: 'not-probed',
        note: listErr ? `★ 一覧を引けませんでした: ${listErr}` : '★ OPENAI_API_KEY が未設定です',
      });
      continue;
    }
    const ok = available.has(model);
    results.push({
      route: r.route,
      model,
      via: 'OpenAI API',
      status: ok ? 'ok' : 'failed',
      note: ok ? '鍵で引いた一覧に在り' : '★ 鍵で引いた一覧に無し',
    });
  }

  return [judgeProbe(results)];
}
