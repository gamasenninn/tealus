/**
 * #438 doctor — 起動した時点の設定で決まっていたことを、起動した時点で言う。
 *
 * ## なぜ要るか
 *
 * 採用第 2 号が踏んだ 3 件は、**3 件とも起動時の設定で決まっていた**のに、
 * **気づいたのは人であってコードではなかった**:
 *
 *   2026-09-10  既定の Deep モデルが ChatGPT アカウントで使えず Deep が全面停止
 *               → サポート班は「CLI が古い」と 2 回誤診し、更新作業を 2 回させた
 *   2026-09-11  同じ理由で Light だけ取り残された (Deep だけ直して終わったつもり)
 *   2026-09-06  workspace に資格情報が入っていた (#419)
 *
 * ## 守る約束 (f8ac2f1 の判断をそのまま継ぐ)
 *
 *   1 ★ **止めない** (warn だけ)。モデルの可否は外部で変わるので、コードが止めると
 *     正しい設定でも動かなくなる (JWT_SECRET の throw とは性質が違う)
 *   2 ★★ **「何を設定すればよいか」を必ず出す**。無いと再ログインへ誤誘導される (#431 の再演)
 *   3 ★★★ **「リストに無ければ安全」とは言わない**。実測した範囲しか知らない
 *   4 ★★★★ **値を出さない**。資格情報は 形・長さ・指紋 (sha256 先頭 8 桁) だけ
 *
 * ## この版の範囲
 *
 * ★ **外部を叩かない**。起動時に呼べることを優先した (起動のたびに外部を叩くと、
 *   外部の不調で起動が遅くなり課金も増える)。**実測する口は別に分ける** (#438 の「2 段にする」)。
 * ★★ この版に無いもの: 外部疎通 / DB migration の適用状態 / workspace の資格情報走査。
 *   後者 2 つは既に別に道具がある (`scan-workspace-secrets.mts` / `db/migrate.mts`) ので、
 *   **作り直さずに doctor から呼ぶ形**を次の版で足す。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkCodexModels } from '../utils/codexModelGuard.mts';
import { scanWorkspaceSecrets } from '../../scripts/scan-workspace-secrets.mts';

export interface Finding {
  id: string;
  level: 'info' | 'warn';
  /** 何が見つかったか (★ 値は出さない) */
  detail: string;
  /** 何を設定すればよいか (★ 約束 2。info でも書ける範囲で書く) */
  fix: string;
}

/** 診断が読む env。★ process.env を直接見ない (テストから再現できるように)。 */
export type DoctorEnv = Record<string, string | undefined>;

/**
 * 資格情報の指紋。★ **値は 1 文字も出さない。**
 * 未設定は「(未設定)」。★★ 空文字の sha256 を出すと、設定されているように見える。
 */
export function fingerprint(value: string | undefined): string {
  if (!value) return '(未設定)';
  const sha = crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
  return `len=${value.length} sha=${sha}`;
}

/** 無いと動かない env。★ 「何を設定すればよいか」を必ず添える。 */
const REQUIRED: Array<{ key: string; why: string }> = [
  { key: 'TEALUS_BOT_ID', why: 'Tealus へ投稿する bot の login id' },
  { key: 'TEALUS_BOT_PASS', why: 'Tealus へ投稿する bot のパスワード' },
  { key: 'TEALUS_API_URL', why: 'Tealus 本体の URL (既定 http://localhost:3000)' },
];

/**
 * 経路ごとのモデル設定。★ 片方だけ直した状態に気づけるよう、必ず並べて出す。
 *
 * ★★ **どの経路が codex の制限を受けるかも並記する。** これを書かないと、制限を受けない
 *   経路のモデルまで「揃っていない」と読まれる —— 2026-09-14 に実際に起きた。
 *   Router は OpenAI API 直 (`OPENAI_API_KEY`) なので使えないモデル表は当たらないのに、
 *   3 行を並べただけの一覧を見て「ここだけ世代が違う」と誤って報告した。
 *   ★★★ **誤診を防ぐための道具が、誤診を作った。** 一覧は「並べれば分かる」ではなく、
 *   **何を比べてよいか**まで書いて初めて読める。
 */
const ROUTE_MODELS: Array<{ key: string; route: string; authOf: (env: DoctorEnv) => string }> = [
  {
    key: 'AGENT_LIGHT_MODEL',
    route: 'Light',
    // ★ LIGHTV2_AUTH=subscription のときだけ codex の制限を受ける (未設定 = API key 経路)。
    authOf: (env) => (env.LIGHTV2_AUTH === 'subscription' ? 'codex(subscription)' : 'OpenAI API'),
  },
  {
    key: 'AGENT_ROUTER_MODEL',
    route: 'Router',
    // ★ router/index.mts は OpenAI client を直接使う。codex を経由しない。
    authOf: () => 'OpenAI API',
  },
  {
    key: 'AGENT_DEEP_CODEX_MODEL',
    route: 'Deep',
    authOf: (env) =>
      (env.DEEP_AGENT_PROVIDER ?? 'claude') === 'codex' &&
      (env.DEEP_CODEX_AUTH ?? 'subscription') === 'subscription'
        ? 'codex(subscription)'
        : 'OpenAI API / 他 provider',
  },
];

/**
 * 設定を診断する。★ **例外を投げない。外部を叩かない。**
 *
 * @returns 見つかったこと (★ 空にはならない。最後に「確かめた項目」を必ず 1 件入れる)
 */
export function runDoctor(env: DoctorEnv): Finding[] {
  const out: Finding[] = [];

  try {
    // ★ 既知の使えないモデル表との照合は f8ac2f1 の実装を使う (作り直さない)。
    //   ★★ 片方で打ち切らず、当てはまるものを全部返す = 「Deep を直したので終わり」を防ぐ。
    const warns = checkCodexModels({
      deepProvider: env.DEEP_AGENT_PROVIDER,
      deepAuth: env.DEEP_CODEX_AUTH,
      deepModel: env.AGENT_DEEP_CODEX_MODEL,
      lightBackend: env.AGENT_LIGHT_BACKEND,
      lightAuth: env.LIGHTV2_AUTH,
      lightModel: env.AGENT_LIGHT_MODEL,
    });
    if (warns.length > 0) {
      out.push({
        id: 'codex-model',
        level: 'warn',
        detail: warns.map((w) => w.message).join('\n'),
        fix: warns.map((w) => `${w.setting} を変更してください`).join(' / '),
      });
    }
  } catch {
    // ★ 診断の失敗で起動を止めない (約束 1)。
  }

  // ★ 警告が出ない設定でも、経路ごとのモデルは **必ず並べて出す**。
  //   2026-09-11 の取り残しは「Deep を直したので終わったつもり」で起きた。
  //   一覧があれば、直した直後に「もう片方が古いまま」が目に入る。
  out.push({
    id: 'route-models',
    level: 'info',
    detail: ROUTE_MODELS.map(
      (m) => `${m.route}: ${m.key}=${env[m.key] ?? '(既定)'} … 経由=${m.authOf(env)}`,
    ).join('\n'),
    // ★ 「見比べてください」だけでは足りない。**比べてよい相手**まで書く。
    fix: '★ 経由が codex(subscription) の行どうしで見比べてください'
      + ' (★★ OpenAI API の行は使えないモデル表の対象外なので、世代が違っていても問題ではありません)',
  });

  const missing = REQUIRED.filter((r) => !env[r.key]);
  if (missing.length > 0) {
    out.push({
      id: 'required-env',
      level: 'warn',
      detail: `設定が見つかりません: ${missing.map((m) => m.key).join(', ')}`,
      fix: missing.map((m) => `${m.key} … ${m.why}`).join('\n'),
    });
  }

  // ★ 資格情報は **指紋だけ**。設定されているかどうかを、値を見ずに判断できる形。
  out.push({
    id: 'credentials',
    level: 'info',
    detail: ['TEALUS_BOT_PASS', 'OPENAI_API_KEY', 'JWT_SECRET']
      .map((k) => `${k}: ${fingerprint(env[k])}`)
      .join('\n'),
    fix: '★ 値は出していません (長さと sha256 の先頭 8 桁のみ)',
  });

  // ★★ 「全部 OK」とは言わない。**確かめた項目を並べるだけ**にする (沈黙を合格と読ませない)。
  out.push({
    id: 'checked',
    level: 'info',
    detail: [
      '確かめた項目: 既知の使えないモデル表 / 経路ごとのモデル設定 / 必須 env / 資格情報の有無',
      // ★ ここは **起動時の口が何を見たか** を言う欄。★★ 手動の口で増えた項目を書くと、
      //   起動時にも見たことになってしまう (#442 で実際に古くなった行を直した)。
      '★ 起動時のこの口が見ていないもの: 外部サービスの疎通 / DB migration の適用状態 /',
      '  辞書オーバーレイの掛け違い / 本線 (cc-main) の生死 / workspace の資格情報走査',
      '★★ 上の 5 つは `npm run doctor` (手動の口) で走ります。★★★ 外部疎通だけは `--probe` を付けたときだけ',
      '★★ 表に無いモデルは「実測していない」だけで、安全の保証ではありません',
    ].join('\n'),
    fix: '実測が要るものは別の口に分けます (#438「2 段にする」/ #442)',
  });

  return out;
}

/**
 * ★ 手動の口だけで走らせる診断 (`npm run doctor`)。
 *
 * ★★ **起動時には呼ばない。** workspace を全深さ歩くので、ルームが増えるほど遅くなる。
 *   起動を遅くしない、が #438 の「2 段にする」の約束。
 *
 * ★★★ ここは採用第 2 号が踏んだ 3 件目 (2026-09-06 workspace に資格情報) に当たる。
 *   走査そのものは #419 の実装をそのまま使う (作り直さない)。
 */
export function runDeepChecks(env: DoctorEnv): Finding[] {
  const out: Finding[] = [];
  const root = env.AGENT_WORKSPACE_ROOT || './agent-workspaces';
  try {
    const r = scanWorkspaceSecrets(root);
    out.push({
      id: 'workspace-secrets',
      level: r.hits.length > 0 ? 'warn' : 'info',
      detail: [
        `走査 ${r.targets.length} agent / テキスト ${r.scanned} 件 (大きすぎて飛ばした ${r.skippedBig} / バイナリ ${r.binary})`,
        r.hits.length > 0
          ? `★★ 資格情報らしきもの ${r.hits.length} 件:\n` +
            r.hits.map((h) => `  ${h.kinds.join(' / ')}\n    ${h.file}`).join('\n')
          : '★ 資格情報らしきものは 0 件 (★★ 値は一切見ていません)',
        `コードが workspace に書くもの (.codex_home 等): ${r.backAgain} 件`,
      ].join('\n'),
      fix:
        r.hits.length > 0
          ? '★ filesystem MCP から読める範囲なので、workspace の外へ移してください (#419)'
          : '★ 0 件は「今は無い」であって「入らない」ではありません (★★ 書き戻りは上の件数で見ます)',
    });
  } catch (err) {
    // ★ 走査が失敗しても診断は続ける。★★ ただし黙らない —— 0 件と区別が付かなくなる。
    out.push({
      id: 'workspace-secrets',
      level: 'warn',
      detail: `workspace を走査できませんでした: ${err instanceof Error ? err.message : String(err)}`,
      fix: '★ AGENT_WORKSPACE_ROOT を確かめてください (★★ 「0 件」ではありません)',
    });
  }
  // #442 (2) 本線の生死。★ fs だけで済むのでここに置く (DB / 外部は別の口)。
  out.push(judgeMainline(minutesSinceMainlineClose(env), MAINLINE_WARN_MINUTES));
  return out;
}

// ---------------------------------------------------------------------------
// #442 実測する口。★ 判定は純関数、読み取りは別の関数。
//   理由: 第 1 版のテストは env を注入するだけで全部書けた。DB / fs / 外部が混ざると
//   そこが崩れて「テストのために実物を用意する」方へ倒れる。**判定だけは注入で書ける形を保つ。**
// ---------------------------------------------------------------------------

/**
 * #442 (2) 本線の close が途絶えてから warn にするまで。
 *
 * ★ 55.1 分は丸めた実測値ではなく、**向こうの定数から出る値**である (2026-09-15 に送り手が内訳を出した):
 * ```
 * max_age 3300 秒 (= 55.000 分) + backoff 3〜12 秒 + login 約 0.1 秒 → ★ 55.05〜55.20 分
 * ```
 * ★★ 2 時間にした理由も数字で決まっている:
 * ```
 * ★ 上流障害では 本線は生きたまま間隔が伸びる (FAILS>5 で backoff ×4 = 12〜48 秒)
 * ★★ 2026-09-06 の WAN 障害では 約 20 分 繋がらなかった
 * → ★★★ 60〜70 分にすると障害のたびに鳴る。2 時間なら 1 時間級の障害を許容しつつ、死は 2 周期以内に捕まる
 * ```
 */
export const MAINLINE_WARN_MINUTES = 120;

/**
 * #442 (1) migration の適用状態。
 * @param pending 未適用のファイル名。★ **null = 引けなかった** (0 件ではない)
 * @param appliedCount 適用済みの件数。null = 引けなかった
 */
export function judgeMigrations(pending: string[] | null, appliedCount: number | null): Finding {
  if (pending === null) {
    return {
      id: 'db-migrations',
      level: 'warn',
      detail: '★ 適用状態を引けませんでした (★★ 「未適用 0 件」ではありません)',
      fix: '★ DB に届いているかを確かめてください (DATABASE_URL / docker compose up)',
    };
  }
  if (pending.length === 0) {
    return {
      id: 'db-migrations',
      level: 'info',
      detail: `適用済み ${appliedCount ?? '?'} 件 / 未適用 0 件`,
      fix: '★ 台帳 (schema_migrations) にある分だけを見ています。★★ 台帳より前に手で当てた分は見えません',
    };
  }
  return {
    id: 'db-migrations',
    level: 'warn',
    detail: `★ 未適用 ${pending.length} 件 (適用済み ${appliedCount ?? '?'} 件):\n` +
      pending.map((f) => `  ${f}`).join('\n'),
    fix: '★ `npm run migrate` を流してください (★★ 台帳が無い DB では先に `npm run migrate -- --baseline`)',
  };
}

/**
 * #442 (2) 本線 (cc-main) の生死。
 *
 * ★ **見張りを立て直さない、という判断の実装**である (2026-09-15)。
 *   こちらの見張り (`cc_stream_unexpected.py`) は 19 日 止まっていたのに、その沈黙が
 *   「異常なし」と見分けられなかった。**新しい見張りを増やすと、同じ形が増える。**
 *   proxy ログの `ua=cc-main` は **生死と異常が同じ 1 欄で読める**ので、引ける口に置くだけにする。
 *
 * @param minutes 最後の close からの経過分。★ **null = 1 度も見つからなかった**
 */
export function judgeMainline(minutes: number | null, warnAfter: number): Finding {
  if (minutes === null) {
    return {
      id: 'cc-main-heartbeat',
      level: 'warn',
      detail: '★ 本線 (ua=cc-main) の close がログに 1 件も見つかりませんでした',
      fix: '★ ログの保存期間 (14 日) を超えたか、本線が一度も繋いでいません。★★ 沈黙は「異常なし」ではありません',
    };
  }
  const over = minutes > warnAfter;
  return {
    id: 'cc-main-heartbeat',
    level: over ? 'warn' : 'info',
    detail: over
      ? `★ 本線の最後の close から ${minutes} 分 (${warnAfter} 分を超過)`
      : `本線の最後の close から ${minutes} 分`,
    fix: over
      ? '★ 向こうのセッションが落ちている可能性があります (セッション終了 / Monitor 死 / 本線死 / 忘れ)'
      : `★ 本線は 55.05〜55.20 分ごとに張り直します (max_age 3300 秒 + backoff 3〜12 秒)。${warnAfter} 分超で warn。★★ 数えているのは本線 1 本だけです (probe や他の購読者は含みません)`,
  };
}

/**
 * #442 (3) が突き合わせる 4 つの件数。
 *
 * ★ **省略できる形にしない。** 省いたものが 0 件に化けると、口は「ずれ 0」という
 *   **妥当に見える嘘**を返す (= 掛け違いが起きている最中に info が出る)。
 *   ★★ 引けなかったときは呼び出し側が明示的に null を入れる。
 */
export interface OverlayCounts {
  /** DB の active な語 */
  dbTerms: number | null;
  /** 在庫 (local.ttl) の語 */
  overlayTerms: number | null;
  /** DB の active な別名 (active な語に属するものだけ) */
  dbAliases: number | null;
  /** 在庫 (local.ttl) の別名 */
  overlayAliases: number | null;
}

const RELOAD_FIX =
  '★ `POST /api/admin/transcription/reload-vocab` を叩くか、本体サーバを再起動してください (★★ DB を直しただけでは入れ替わりません)';

/** 1 対の件数を 1 行に整形する。★ 差の向きを言葉にするのはここだけ (2 か所に書かない)。 */
function driftLine(label: string, db: number, overlay: number): string {
  return (
    `★ DB の active な${label} ${db} 件 に対して 在庫の${label} ${overlay} 件 (差 ${overlay - db})\n` +
    `  ★★ ${overlay > db ? `在庫の方が多い = DB で落とした${label}がまだ効いています` : `在庫の方が少ない = DB で足した${label}がまだ効いていません`}`
  );
}

/**
 * #442 (3) 辞書オーバーレイの掛け違い (#384)。
 *
 * ★ DB の行を直しても、在庫の語彙は `refreshVocabFromTable` を呼ぶまで入れ替わらない。
 *   ★★ 走るのは 起動時 / admin endpoint / organon watcher / **自己成長辞書の昇格** の 4 つ。
 *   watcher は **ttl の内容 hash が変わったときしか発火しない**ので、organon が ttl を
 *   変えない日は そこからは治らない。
 *   ★★★ 2026-09-18 実測: 別件の昇格 (`高坂→保坂`) の副作用で 76 秒後に揃った。
 *   **対になっていないのではなく、対になったり ならなかったりする** ——
 *   だから「揃っているはず」と読めず、引ける口が要る。
 * ★★★★ 2026-09-15 に `organonDictPrune --apply` の直後に実測し、消費側 2 か所とも古いままだった。
 *   **黙って続く**のが害なので、引ける口に出す (自動で直すことはしない)。
 *
 * ★★★★★ 2026-09-18: **別名 (alias) も見る。** それまでは語の件数しか見ておらず、
 *   同日に 語 303 = 303 のまま alias を 1 行だけ動かした実例が **1 件も引っかからなかった**。
 *   ★ organon の撤去も 自己成長辞書も 動かすのは主に alias 側なので、語だけでは薄い。
 */
export function judgeOverlayDrift(counts: OverlayCounts): Finding {
  // ★ undefined (渡し忘れ) を 0 と読まない。引けなかったのと同じ扱いに倒す
  const dbTerms = counts?.dbTerms ?? null;
  const overlayTerms = counts?.overlayTerms ?? null;
  const dbAliases = counts?.dbAliases ?? null;
  const overlayAliases = counts?.overlayAliases ?? null;

  if (dbTerms === null || overlayTerms === null || dbAliases === null || overlayAliases === null) {
    return {
      id: 'dict-overlay-drift',
      level: 'warn',
      detail:
        `★ 突き合わせできませんでした\n` +
        `  語   DB=${dbTerms ?? '引けず'} / 在庫=${overlayTerms ?? '引けず'}\n` +
        `  別名 DB=${dbAliases ?? '引けず'} / 在庫=${overlayAliases ?? '引けず'}`,
      fix: '★ DB への到達と local.ttl の場所を確かめてください (★★ 「ずれ 0」ではありません)',
    };
  }

  const lines: string[] = [];
  if (dbTerms !== overlayTerms) lines.push(driftLine('語', dbTerms, overlayTerms));
  if (dbAliases !== overlayAliases) lines.push(driftLine('別名', dbAliases, overlayAliases));

  if (lines.length === 0) {
    return {
      id: 'dict-overlay-drift',
      level: 'info',
      detail: `DB の active な語 ${dbTerms} 件 = 在庫の語 ${overlayTerms} 件 / 別名 ${dbAliases} 件 = 在庫の別名 ${overlayAliases} 件`,
      fix: '★ 件数が同じだけで、中身までは突き合わせていません',
    };
  }
  return {
    id: 'dict-overlay-drift',
    level: 'warn',
    detail: lines.join('\n'),
    fix: RELOAD_FIX,
  };
}

/** #442 (4) 1 経路の疎通結果。★ status は 3 値。 */
export interface ProbeResult {
  route: string;
  model: string;
  /** どの資格情報でその経路に届くのか。★ 「何を比べてよいか」を読み手に渡す */
  via: string;
  /** ok = 叩いて通った / failed = 叩いて通らなかった / not-probed = 叩いていない */
  status: 'ok' | 'failed' | 'not-probed';
  note: string;
}

/**
 * #442 (4) 外部疎通。
 * ★ **「叩けなかった」と「叩かなかった」を区別する。** 沈黙と同じにしないための 3 値。
 */
export function judgeProbe(results: ProbeResult[]): Finding {
  const failed = results.filter((r) => r.status === 'failed');
  const probed = results.filter((r) => r.status !== 'not-probed');
  const lines = results.map(
    (r) => `  [${r.status}] ${r.route}: ${r.model} … 経由=${r.via}${r.note ? ` … ${r.note}` : ''}`
  );
  return {
    id: 'external-reachability',
    level: failed.length > 0 ? 'warn' : 'info',
    detail: [
      `叩いた ${probed.length} / ${results.length} 経路 (通った ${probed.length - failed.length} / 通らなかった ${failed.length})`,
      ...lines,
      probed.length === 0 ? '★ この実行では 1 経路も叩いていません (= 失敗ではありません)' : '',
    ]
      .filter(Boolean)
      .join('\n'),
    fix:
      failed.length > 0
        ? '★ 通らなかった経路のモデル名と鍵を確かめてください (★★ ログインし直しても直りません)'
        : '★ 言えるのは「叩いて通った」ことだけです。not-probed の経路については何も確かめていません',
  };
}

/** ログの 1 行から close 時刻を読む。★ 形が変わったら null (推測しない)。 */
const LOG_TS = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

/**
 * #442 (2) の読み取り。★ **新しいファイルから遡る** (最新ログだけ見ると、
 * 本線が数日前に死んだ場合に「見つからない」と「今日は静か」が混ざる)。
 */
export function lastMainlineCloseAt(logDir: string): Date | null {
  let files: string[];
  try {
    files = fs
      .readdirSync(logDir)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse();
  } catch {
    return null; // ★ ディレクトリが無い = 例外にしない (診断は続ける)
  }
  for (const f of files) {
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(logDir, f), 'utf8').split('\n');
    } catch {
      continue;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i];
      // ★ `ua=cc-main` は本線だけが送る。★★ `ua=curl/8.7.1` は probe-b と区別が付かないので数えない。
      if (!ln.includes('ua=cc-main')) continue;
      const m = LOG_TS.exec(ln);
      if (!m) continue;
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
  }
  return null;
}

/** 本線の最後の close からの経過分。★ 見つからなければ null。 */
export function minutesSinceMainlineClose(env: DoctorEnv, now: Date = new Date()): number | null {
  const dir =
    env.TEALUS_SERVER_LOG_DIR || path.resolve(import.meta.dirname, '../../../server/logs');
  const at = lastMainlineCloseAt(dir);
  if (!at) return null;
  return Math.floor((now.getTime() - at.getTime()) / 60000);
}

/** 人が読む 1 本のテキストにする。★ 出力そのものは呼び出し側が決める (ログ / 標準出力)。 */
export function formatFindings(findings: Finding[]): string {
  return findings
    .map((f) => `[doctor:${f.level}] ${f.id}\n  ${f.detail.split('\n').join('\n  ')}\n  → ${f.fix}`)
    .join('\n');
}

/**
 * #384 撤去待ち —— **射影 → DB** の段に残っている organon 由来の行。
 *
 * ★ 撤去は 2 段ある。★★ 下の段 (DB → 在庫) は `dict-overlay-drift` が既に見ている。
 *   ここは **上の段**: organon が deprecated にした語が、まだ DB で active なまま。
 *
 * ★★★ 手で tombstone したのは 8/23・8/30・9/14 の 3 回。★ いずれも **別件を調べていた途中で
 *   偶然**見つかっている (気づく口が無かった)。
 *
 * ★★★★ **A (sync に自動撤去を組み込む) / B (手動 + 検知) のどちらでも要る**:
 *   A を選んでも歯止め (上限 5 件 / 下振れ / 滞留) に当たれば **撤去は静かに止まる**ので、
 *   止まったまま残っている件数を数える口が無いと、同じ穴がもう一度開く。
 *
 * ★★★★★ 約束:
 *   - **引けなかったら「0 件」と言わない** (= 壊れた値は沈黙より悪い)
 *   - **pull の記録が足りなければ判定しない** —— 不在が続いた証拠が無いものを「待ち」と数えない
 *     (★ 日数ではなく pull 回数で切る、は `staleCutoff` 側で決めている)
 *   - **別名は件数だけ**。★ victim を名指ししない (#384 の約束。1 件だと「あれだろう」と埋める)
 *   - **自動で直さない。** ★ 次の手は dry-run から案内する
 */
export interface RetractionBacklog {
  /**
   * ★★★★ DB に届いたか。★ false = 届いていない。
   *
   * ★★ これが無いと「届かなかった」と「pull の記録が足りない」を **呼ぶ側が区別できず**、
   *   どちらかに寄せて嘘を書くことになる (★★★ 表せない状態がある入力の形は、それ自体が穴)。
   */
  reachable: boolean;
  /** 撤去待ちの語。★ null = 引けなかった */
  staleTerms: string[] | null;
  /**
   * 撤去待ちの別名の件数。★ **null = この口では数えていない**。
   *
   * ★★★★ 別名の撤去対象は **射影との対の突き合わせ**で決まる
   *   (`(term, alias) NOT IN unnest(...)`)。★ updated_at では決まらないので、
   *   DB だけを引く この口からは **正しく数えられない**。
   *   ★★ それらしい数を出すより「数えていない」と書く (= 壊れた値は沈黙より悪い)。
   */
  staleAliasCount: number | null;
  /** 基準線 = K 回前の pull 時刻。★ null = pull の記録が K 回に満たない */
  cutoff: Date | null;
  /** 記録されている pull の回数 */
  pullsRecorded: number;
}

/** ★ 1 行に並べる語の上限 */
const RETRACTION_SHOW_MAX = 5;
/** ★ 歯止め (b) の既定値。★★ server 側の DEFAULT_MAX_VICTIMS と同じ値を **予告にだけ**使う */
const RETRACTION_MAX_VICTIMS = 5;

export function judgeRetractionBacklog(b: RetractionBacklog): Finding {
  const id = 'organon-retraction';

  // ★ 届かなかったのが最優先。★★ 届いていないのに「記録が足りない」と書かない
  if (!b.reachable) {
    return {
      id,
      level: 'warn',
      detail: '★ 撤去待ちを引けませんでした (★★ DB に届いていない可能性)',
      fix: '★ DB への到達を確かめてください。★★ 引けないことと「残っていないこと」は別です',
    };
  }
  if (b.cutoff === null) {
    return {
      id,
      level: 'info',
      detail: `★ pull の記録が ${b.pullsRecorded} 回しかないため判定していません (★★ 不在が続いた証拠になりません)`,
      fix: '★ organon の pull が数回 走ってからもう一度引いてください',
    };
  }
  if (b.staleTerms === null) {
    return {
      id,
      level: 'warn',
      detail: '★ 撤去待ちを引けませんでした (★★ DB に届いていない可能性)',
      fix: '★ DB への到達を確かめてください。★★ 引けないことと「残っていないこと」は別です',
    };
  }
  // ★ 別名を数えていない旨は、どの枝でも同じ 1 行で出す (★★ 2 か所に書かない)
  const aliasNote =
    b.staleAliasCount === null
      ? '  ★ 別名はこの口では数えていません (★★ 射影との対の突き合わせが要るため。dry-run の側で見ます)'
      : null;

  const cut = b.cutoff.toISOString().slice(0, 16).replace('T', ' ');
  if (b.staleTerms.length === 0 && (b.staleAliasCount ?? 0) === 0) {
    return {
      id,
      level: 'info',
      detail: [`★ 撤去待ちの語はありません (基準線 ${cut} UTC / pull ${b.pullsRecorded} 回)`, aliasNote]
        .filter(Boolean)
        .join('\n'),
      fix: '★ 件数だけを見ています。中身の突き合わせは organonDictPrune の dry-run で',
    };
  }

  const head = b.staleTerms.slice(0, RETRACTION_SHOW_MAX).join(' / ');
  const tail = b.staleTerms.length > RETRACTION_SHOW_MAX ? ` ほか ${b.staleTerms.length - RETRACTION_SHOW_MAX} 件` : '';
  const aliasPart = b.staleAliasCount === null ? '' : ` / 別名 ${b.staleAliasCount} 件`;
  const lines = [
    `★ 射影に無いのに DB で active な organon 由来の行: 語 ${b.staleTerms.length} 件${aliasPart}`,
    `  ★★ 基準線 ${cut} UTC より前で止まっています (pull ${b.pullsRecorded} 回)`,
  ];
  if (b.staleTerms.length > 0) lines.push(`  語: ${head}${tail}`);
  if (aliasNote) lines.push(aliasNote);
  // ★ 別名は件数だけ (名指ししない)
  if (b.staleTerms.length > RETRACTION_MAX_VICTIMS) {
    // ★★★★ 「叩けば消える」と読ませない。★ 歯止め (b) に当たって **実行されない**
    lines.push(`  ★★★ 1 回の上限 ${RETRACTION_MAX_VICTIMS} 件を超えているので、叩いても撤去は実行されません`);
  }
  return {
    id,
    level: 'warn',
    detail: lines.join('\n'),
    fix: '★ `npx tsx server/scripts/organonDictPrune.mts` (既定 dry-run) で中身を見てから、人が `--apply` を判断してください',
  };
}

/**
 * ルームトリガーが生きているか (2026-09-21)。★ 材料は **投稿そのものに残る印**。
 *
 * ★★★★ なぜ要るか: 2026-09-21 に、**正常に動いているトリガーが「壊れている」と見えた**。
 *   確かめる手が「サーバログを grep」しかなく、★ 120 分間隔の待ちを故障と読んだ。
 *   ★★ 同じ日に「置いたものが生きているか見る口が無い」が 3 件 出ている。
 *
 * ★★★ **停滞の閾値は置かない。** 撃っていないことは異常とは限らない (材料が無ければ撃たない)。
 *   ★ 閾値を置くと定休・閑散日に誤報する —— #441 で同じ罠を踏みかけた。
 *   ★★★★ **warn にするのは「見に行けなかったとき」だけ** (= 壊れた値は沈黙より悪い)。
 */
export interface TriggerLiveness {
  /** DB に届いたか。★ false = 「撃っていない」ではなく「見ていない」 */
  reachable: boolean;
  /** 有効なトリガーの id。★ null = 設定を読めなかった (★★ 「有効 0 本」と混ぜない) */
  enabledIds: string[] | null;
  /** trigger id → 最終発火時刻。★ 印は roomTriggers.mts:85 が書く (docs/06 §10) */
  lastFired: Record<string, Date>;
  now: Date;
}

/** ★ 経過を 1 語で。★★ 読む側に毎回 引き算させない */
function sinceLabel(from: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
  if (min < 60) return `${min} 分前`;
  if (min < 60 * 24) return `${Math.round(min / 60)} 時間前`;
  return `${Math.round(min / (60 * 24))} 日前`;
}

export function judgeTriggerLiveness(t: TriggerLiveness): Finding {
  const id = 'room-triggers';
  const limit =
    '★ 撃っていないこと自体は異常ではありません (★★ 材料が無ければ撃たないのが正しい)。'
    + '★★★ この口が warn にするのは **見に行けなかったとき**だけです';

  if (!t.reachable) {
    return {
      id,
      level: 'warn',
      detail: '★ 発火の記録を引けませんでした (★★ DB に届いていない可能性)',
      fix: '★ DB への到達を確かめてください。★★ 引けないことと「撃っていないこと」は別です',
    };
  }
  if (t.enabledIds === null) {
    return {
      id,
      level: 'warn',
      detail: '★ トリガーの設定を読めませんでした (★★ 有効なトリガーが無いこととは別です)',
      fix: '★ server/config/room-triggers.json が読めるか確かめてください (★★ path は ROOM_TRIGGERS_PATH で変えられます)',
    };
  }
  if (t.enabledIds.length === 0) {
    return {
      id,
      level: 'info',
      detail: '★ 有効なトリガーはありません',
      fix: '★ server/config/room-triggers.json の enabled を見てください',
    };
  }

  // ★ 並べるのは **設定に在るものだけ**。★★ 止めたトリガーの残骸は数えない
  const lines = [`★ 有効 ${t.enabledIds.length} 本`];
  for (const tid of t.enabledIds) {
    const at = t.lastFired[tid];
    lines.push(
      at
        ? `  ${tid}: 最終発火 ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC (${sinceLabel(at, t.now)})`
        : `  ${tid}: ★ まだ 1 度も撃っていません`
    );
  }
  return { id, level: 'info', detail: lines.join('\n'), fix: limit };
}
