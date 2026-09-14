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
import { checkCodexModels } from '../utils/codexModelGuard.mts';

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

/** 経路ごとのモデル設定。★ 片方だけ直した状態に気づけるよう、必ず並べて出す。 */
const ROUTE_MODELS: Array<{ key: string; route: string }> = [
  { key: 'AGENT_LIGHT_MODEL', route: 'Light' },
  { key: 'AGENT_ROUTER_MODEL', route: 'Router' },
  { key: 'AGENT_DEEP_CODEX_MODEL', route: 'Deep (codex)' },
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
    detail: ROUTE_MODELS.map((m) => `${m.key}=${env[m.key] ?? '(既定)'} … ${m.route}`).join('\n'),
    fix: '★ 片方の経路だけ直していないか、3 行を見比べてください',
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
      '★ この版で確かめていないもの: 外部サービスの疎通 / DB migration の適用状態 / workspace の資格情報走査',
      '★★ 表に無いモデルは「実測していない」だけで、安全の保証ではありません',
    ].join('\n'),
    fix: '実測が要るものは別の口に分けます (#438「2 段にする」)',
  });

  return out;
}

/** 人が読む 1 本のテキストにする。★ 出力そのものは呼び出し側が決める (ログ / 標準出力)。 */
export function formatFindings(findings: Finding[]): string {
  return findings
    .map((f) => `[doctor:${f.level}] ${f.id}\n  ${f.detail.split('\n').join('\n  ')}\n  → ${f.fix}`)
    .join('\n');
}
