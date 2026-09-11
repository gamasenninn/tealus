/**
 * codex 経路のモデル可否ガード (2026-09-11)
 *
 * ## ★ 発端
 *
 * 採用者環境 (v0.9) で Deep Codex が**全面停止**した (サポート班の報告、2026-09-10)。
 * 既定値 `AGENT_DEEP_CODEX_MODEL='gpt-5.4'` が ChatGPT アカウントでは使えず、
 * codex がモデル一覧を引きに行って `unknown variant 'max'` でデコードに失敗し stream が切れる。
 *
 * ★★ **画面には `auth failed (unauthorized)` と出る** ので、**再ログインへ誤誘導する**
 * (#422 の修正は v0.9 に入っていない)。★★★ 採用者が自力で真因に到達し、サポート班は
 * 「CLI が古い」と 2 回誤診して更新作業を 2 回させた。
 *
 * ★★★★ 本家でも同じ根で 2026-09-10 朝に Light v2 が 400 で落ちている
 * (`AGENT_LIGHT_MODEL='gpt-5.4-mini'`)。★ **9/6 に Deep を移した記録が `.env` にあったのに
 * Light だけ取り残されていた** ので、**人の注意では落ちる**と判断してコードに入れる。
 *
 * ## ★★★ 守る約束 3 つ
 *
 * 1. ★ **止めない (warn だけ)**。モデルの可否は外部 (OpenAI 側) で変わるので、
 *    コードが止めると**正しい設定でも動かなくなる**。JWT_SECRET の throw とは性質が違う。
 * 2. ★★ **「何を設定すればよいか」を必ず出す**。これが無いと再ログインへ誤誘導される。
 * 3. ★★★ **「リストに無ければ安全」とは言わない**。実測した範囲しか知らない。
 *
 * ## ★ 経路の見分け (★★ 一律に警告してはいけない)
 *
 * ```
 * Router / Light v1   openai.chat.completions = ★ OpenAI API 経路 → mini の制限は無い
 * Light v2 / Deep     ★★ codex 経路。★★★ ただし subscription のときだけ mini 不可
 * ```
 * ★ `DEEP_AGENT_PROVIDER` の既定は `claude` なので、**既定では Deep は codex を通らない**
 * (= 既定のままの環境は壊れない)。★★ 壊れるのは **codex を明示的に設定した環境**。
 */

/**
 * ★★★ ChatGPT アカウント (subscription) の codex では使えないと**実測した**モデル。
 *
 * ```
 * 2026-09-06  gpt-5.4        ✗  (#423、本家の Deep)
 * 2026-09-10  gpt-5.4-mini   ✗  (本家の Light)
 * 2026-09-10  gpt-5.5-mini   ✗  (本家の実測)
 * 2026-09-10  gpt-5.6        ✗  (★ 採用者#2 の実測)
 * 2026-09-10  gpt-5.5        ○  / gpt-5.6-luna ○
 * ```
 * ★ **mini は系統ごと不可。★★ 「新しければ良い」でもない** —— `gpt-5.6` は駄目で
 * `gpt-5.6-luna` は通る。★★★ **名前ごとに違うので、前方一致で判定しないこと。**
 *
 * ★★★★ **ここに無いモデルが安全という意味ではない。** 実測していないものは分からない。
 */
export const KNOWN_UNSUPPORTED_CODEX_MODELS: readonly string[] = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5-mini',
  'gpt-5.6',
];

/** いま使えると実測できているもの (★ 警告文で案内する先) */
export const RECOMMENDED_CODEX_MODEL = 'gpt-5.5';

/** 実測した日付 (★ モデルの可否は変わるので、いつの情報かを警告に載せる) */
const MEASURED_ON = '2026-09-10';

export interface CodexModelGuardInput {
  /** DEEP_AGENT_PROVIDER (既定 'claude') */
  deepProvider?: string;
  /** DEEP_CODEX_AUTH (既定 'subscription') */
  deepAuth?: string;
  /** AGENT_DEEP_CODEX_MODEL */
  deepModel?: string;
  /** AGENT_LIGHT_BACKEND (既定 'v2') */
  lightBackend?: string;
  /** LIGHTV2_AUTH (★ 未設定 = API key 経路) */
  lightAuth?: string;
  /** AGENT_LIGHT_MODEL */
  lightModel?: string;
}

export interface CodexModelWarning {
  /** 直すべき env の名前 */
  setting: string;
  /** いま設定されているモデル */
  model: string;
  /** ログに出す 1 行 */
  message: string;
}

function buildMessage(setting: string, model: string): string {
  return `[model-guard] ${setting}=${model} は ChatGPT アカウント (subscription) の codex では`
    + `使えません (${MEASURED_ON} 実測)。${setting}=${RECOMMENDED_CODEX_MODEL} を設定してください。`
    + ' ★ 認証の問題ではないので、ログインし直しても直りません'
    + ` (表示は auth failed / 400 になります)。★ mini は系統ごと不可で、新しければ良いわけでもない`
    + ` (gpt-5.6 ✗ / gpt-5.6-luna ○)。★ ここに挙げていないモデルは実測していないだけで、安全の保証ではありません。`;
}

/**
 * codex 経路を通る設定のうち、既知の使えないモデルを指しているものを返す。
 *
 * @returns 警告の配列 (★ 問題が無ければ空)。★★ 片方で打ち切らず、当てはまるものを全部返す
 */
export function checkCodexModels(input: CodexModelGuardInput): CodexModelWarning[] {
  const out: CodexModelWarning[] = [];
  const bad = (m: string | undefined): m is string => !!m && KNOWN_UNSUPPORTED_CODEX_MODELS.includes(m);

  // ★ Deep: provider=codex かつ subscription のときだけ codex の制限を受ける
  const deepProvider = input.deepProvider ?? 'claude';
  const deepAuth = input.deepAuth ?? 'subscription';
  if (deepProvider === 'codex' && deepAuth === 'subscription' && bad(input.deepModel)) {
    out.push({
      setting: 'AGENT_DEEP_CODEX_MODEL',
      model: input.deepModel,
      message: buildMessage('AGENT_DEEP_CODEX_MODEL', input.deepModel),
    });
  }

  // ★ Light: backend=v2 かつ LIGHTV2_AUTH='subscription' のときだけ。
  //   ★★ 未設定は API key 経路なので対象外 (mini が使える)
  const lightBackend = input.lightBackend ?? 'v2';
  if (lightBackend === 'v2' && input.lightAuth === 'subscription' && bad(input.lightModel)) {
    out.push({
      setting: 'AGENT_LIGHT_MODEL',
      model: input.lightModel,
      message: buildMessage('AGENT_LIGHT_MODEL', input.lightModel),
    });
  }

  return out;
}
