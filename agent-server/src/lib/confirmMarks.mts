/**
 * 〔要確認〕を「台帳に在るか」で 2 つに割る (2026-09-24)。
 *
 * ★ **何が問題か** —— 朝礼/終礼の議事録に付く 〔要確認〕には 2 つの理由が混ざっている:
 *   ① 台帳に無い語        → ★ 人は「登録するか」を決める
 *   ② 台帳に在るが自信が無い → ★ LLM の自信。人は「聞き直す」しかない
 *   ★★ 1 つの印にまとまっているので、**読む人はどちらの理由で付いたか分からない。**
 *   ★★★ 人が手を入れた印のうち、印が外れだったのは **24.8% (n=254)** —— 議事録クラウドの版
 *     (history.php) を 191 便ぶん引いた全数 (2026-09-24)。★ 29.4% は Tealus 側 n=68 の値。
 *
 * ★★★★★ **この段が「誤報の多い群」を切り出すかは、決められない。** (2026-09-24)
 * ```
 *   ★ 印の徒は 3 つに分かれ、★★ **3 つ目は真偽が記録されていない**:
 *     語を直した     = 誤りだったと確定
 *     印だけ外した   = 誤りでなかったと確定
 *     ★★★★ 残された = **不明** (人が見たうえで残したのか、手が回らなかったのか分からない)
 *
 *   ★ 議事録・人が直した便の 474 箇所:
 *                  残された  印だけ外した  語を直した   計   誤り率の下限〜上限   不明
 *       台帳に在る      78         16         46    140    32.9% 〜 88.6%   55.7%
 *       台帳に無い     142         47        145    334    43.4% 〜 85.9%   42.5%
 *   ★★★★★ **2 つの帯は完全に重なる。** ★ どちらに誤りが多いかは この材料では決まらない。
 *
 *   ★★ 2026-09-22 の n=68 は canon 基準で 41.4% vs 20.5% と差が見えていた。
 *      ★★★ 「人が手を入れた印」だけを分母にすると 25.8% vs 24.5% (0.2 SE) で消える。
 *      ★★★★ ただし **それも 220 箇所 (46%) を捨てた分母**なので、「差が無い」とも言えない。
 *      ★ 正しい言い方は **「決められない」**。
 *   ★★★★★ なので「在る側が誤報の当事者」とは書かない。**残る意味は
 *      『印が付いた理由を読む人に伝える』の 1 つだけ。**
 *
 *   ★ 決めるには「誰も触らなかった印が正しかったか」を **人に聞く**材料が要る。
 *   ★★ この段の効き目を後で測るときも、誤報率ではなく
 *      **「残された印が減ったか」**を主指標に置くこと (★★★ 誤報率は不明が多すぎて動かない)。
 * ```
 *
 * ★★★★★ **印を足すのは「在る」側だけ。「無い」とは言わない。**
 *
 * ```
 * ★ 台帳 (dictionary.local.ttl) は **意図的に部分的** —— 射影は Role / Organization しか
 *   運ばない (#331 Option 1)。★★ 地名 (Location) は canon に confirmed で在っても台帳に無い。
 * ★★★ 実測: 「台帳に無い」を [未登録] と主張すると、316 箇所のうち **31 (9.8%) が
 *   canon には登録済み**だった (Location 24 / Role 3 / Polyseme 2 / Shared 2)。
 * ★★★★ 不在の主張は、台帳が部分的な分だけ嘘になる。在ることの主張は引いた台帳で確かめられる。
 * ```
 *
 * ★★★ **実測の割れ方** (2026-09-24 / 朝礼+終礼):
 * ```
 *   台帳 = dictionary.local.ttl + 末尾の敬称外し
 *
 *   ★★★★★ この段が実際に当たるのは **人が触る前の文面** (投稿の直前) なので、
 *     数えるべき母集団は **編集 0 の便**:
 *       編集 0 の 109 便 / 印 412    登録済 151 (36.7%) / そのまま 261 (63.3%)  ← ★ これが実際の姿
 *
 *   ★ 参考 (母集団が違う。**そのまま引かないこと**):
 *       全 166 便 / 印 529          登録済 213 (40.3%) / そのまま 316 (59.7%)
 *       編集あり 57 便 / 印 117     登録済  62 (53.0%) / そのまま  55 (47.0%)
 *     ★★ 人が直すと 台帳に在る語へ寄る (36.7% → 53.0%)。★★★ 混ぜると 3.6pt 押し上がる。
 *     ★★★★ 最初 40.3% と書いたのは この混入で、**2026-09-24 に訂正した** (§16.3 分子と分母は
 *       同じ母集団から取ったか)。
 *
 *   ★ 台帳を canon (organon.ttl) にすると割れ方が変わる。**基準を変えると数が変わる**ので、
 *     ここは agent が実際に読む local.ttl に合わせている。
 * ```
 *
 * ★★★★ **prompt では分けない** —— LLM は台帳を持っていない (注入されるのは別名ブロックだけ)。
 *   分けさせると「注入辞書」と「実台帳」の 2 つの基準ができる。**後段で機械的に足す。**
 *
 * ★★★★★ **この段が直せないもの** (測って分かっている):
 *   ★ 語の取り出しは印の直前 12 文字なので、印が **句や節**に付いていると句を拾う
 *     (`議事録作成時の` / `今日と`)。★★ B 標本 20 件中 2 件 = 10%。★★★ 句は台帳に無いので
 *     **触らない側に落ちる** = この形では害が出ない (不在を主張しないため)。
 *   ★★★★ **語の後ろに付いていない印には、そもそも当たらない。** 2026-09-24 実測:
 *     `通話履歴報告書` は 186 便すべてで **語つきの印 0 / 語なしの印 53**。
 *     ★ この型では この段は 1 件も動かない。★★ 効くのは今のところ `議事録` だけ。
 *   ★ **印を足しても人手が減る証拠はまだ無い。** ここで主張しているのは
 *     「印の意味が 2 つに分かれる」までである。
 */
import fs from 'node:fs';
// ★★★★★ `server/scripts/organonDictProjection.mts` から取らない —— あちらは `n3` を読むので、
//   agent-server の CI ジョブ (server の node_modules が無い) で型検査が落ちる。
//   ★ 2026-09-24 に実際に 5 回 赤にした。★★ 手元では server/node_modules が見えるので通ってしまう。
import { stripHonorific } from '../../../server/src/services/honorific.mts';
import { loadVocabEntriesFromTtl, DEFAULT_LOCAL_TTL_FILE } from './vocabContext.mts';
import { logger } from './logger.mts';

/**
 * 印の 2 形。★ 全角と半角の両方が実在する (2026-09 に半角→全角へ切り替わっている)。
 * ★★ 閉じ括弧が直後に来る形だけを見るので、**既に `・登録済` が付いた印には当たらない**
 *   (= 2 度かけても増えない)。
 */
const MARK = /([[〔])要確認([\]〕])/g;

/** 台帳に在ったときに足す語。★ 「在る」ことだけを言う */
const IN_LEDGER_SUFFIX = '・登録済';

/**
 * 印の直前から語を取る。★ 記号 (`*` 空白 バッククォート) は語に含めない
 * = **印そのものへの言及** (「必要に応じて [要確認] を付ける」) はここで空になる。
 */
const TOKEN_TAIL = /[一-龥々ぁ-んァ-ヶーA-Za-z0-9]{1,12}$/;

export interface SplitResult {
  text: string;
  /** 台帳に在ったので 〔要確認・登録済〕にした数 */
  annotated: number;
  /** 台帳に無かったのでそのまま残した数 */
  kept: number;
  /** 語が取れず触らなかった数 (= 印への言及) */
  skipped: number;
}

/**
 * 台帳の表層集合から「この語は台帳に在るか」を作る。
 *
 * ★ 2 方向に効かせる (どちらも実測で必要だと分かった形):
 *   ① **前から削る** —— 印の直前 12 文字で取るので、前に余計なものが付く
 *      (`第二展示場の佐藤さん`)。★ 2 文字未満までは削らない (1 文字で当てると
 *      「野生」が「生」で当たる)
 *   ② **末尾の敬称を 1 つ外す** —— 射影 (`foldRedundantAliases`) が敬称つきの別名を
 *      **意図して畳んでいる**ので、台帳には `田部井さん` が無く `田部井` しかない。
 *      ★★ 実測: これを入れないと 59 箇所 (40 語) が「台帳に無い」側へ落ちた
 *      (`田部井さん` 7 / `五月女さん` 4 / `保坂さん` 4 …)。
 */
export function buildLedgerLookup(surfaces: Set<string>): (token: string) => boolean {
  return (token: string): boolean => {
    const bare = stripHonorific(token);
    for (const t of bare ? [token, bare] : [token]) {
      for (let i = 0; i < t.length; i++) {
        const s = t.slice(i);
        if (s.length < 2) break;
        if (surfaces.has(s)) return true;
      }
    }
    return false;
  };
}

/**
 * 本文の 〔要確認〕のうち、**語が台帳に在るものだけ**に 「・登録済」を足す。
 *
 * ★ **括弧の種類はそのまま保つ** (全角の印は全角の印に)。
 * ★★ 語が取れない印と、台帳に無い語の印は **1 文字も触らない**。
 */
export function splitConfirmMarks(
  text: string,
  isInLedger: (token: string) => boolean,
): SplitResult {
  let annotated = 0;
  let kept = 0;
  let skipped = 0;
  const out = text.replace(MARK, (whole, open: string, close: string, offset: number) => {
    const token = TOKEN_TAIL.exec(text.slice(Math.max(0, offset - 40), offset))?.[0];
    if (!token) { skipped++; return whole; }
    if (!isInLedger(token)) { kept++; return whole; }
    annotated++;
    return `${open}要確認${IN_LEDGER_SUFFIX}${close}`;
  });
  return { text: out, annotated, kept, skipped };
}

/** ★ 台帳は 1 プロセスで 1 度だけ読む。★★ mtime が変わったら読み直す (pull で書き換わる) */
let cached: { mtimeMs: number; surfaces: Set<string> } | null = null;

/**
 * agent が実際に引ける台帳 (local.ttl) の表層集合。
 *
 * ★ 読めなければ null —— **空集合を返さない**。空集合は「1 件も登録済が付かない」という
 *   もっともらしい姿になり、台帳が落ちたことに気づけなくなる。
 *
 * ★★★★★ **try/catch だけでは足りない。** `loadVocabEntriesFromTtl` は **throw しない** ——
 *   file が無くても parse に失敗しても **0 件を返す** (doctorDeep にも同じ注記がある)。
 *   ★ 2026-09-24 の最初の実装はそこを掴めておらず、**docstring の約束を果たしていなかった**。
 *   ★★ 0 語だったら null にし、**warn に出す** (★★★ 本番の台帳は 1,074 表層なので、
 *      0 語は「そういう日」ではなく壊れている合図)。
 */
export function loadLedgerSurfaces(ttlPath: string = DEFAULT_LOCAL_TTL_FILE): Set<string> | null {
  try {
    const { mtimeMs } = fs.statSync(ttlPath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.surfaces;
    const surfaces = new Set<string>();
    for (const e of loadVocabEntriesFromTtl(ttlPath)) {
      if (e.term) surfaces.add(e.term);
      for (const a of e.aliases) if (a) surfaces.add(a);
    }
    if (surfaces.size === 0) {
      // ★ cache しない —— 直ったら次の呼び出しで拾えるように
      logger.warn(`[confirmMarks] 台帳から 1 語も取れませんでした (印はそのまま出します): ${ttlPath}`);
      return null;
    }
    cached = { mtimeMs, surfaces };
    return surfaces;
  } catch (err) {
    logger.warn(`[confirmMarks] 台帳を読めません (印はそのまま出します): ${String(err)}`);
    return null;
  }
}

/**
 * 投稿直前に印を割る。★ 台帳が読めないときは **本文をそのまま返す**。
 * ★★ 何件足したかを log に出す —— 置いただけで効いていない状態に気づけるように。
 */
export function applyConfirmMarkSplit(text: string): string {
  MARK.lastIndex = 0;
  if (!MARK.test(text)) { MARK.lastIndex = 0; return text; }
  MARK.lastIndex = 0;
  const surfaces = loadLedgerSurfaces();
  if (!surfaces) return text;
  const r = splitConfirmMarks(text, buildLedgerLookup(surfaces));
  if (r.annotated || r.kept) {
    logger.info(`[confirmMarks] 印を割りました: 登録済 ${r.annotated} / そのまま ${r.kept} (言及 ${r.skipped}・台帳 ${surfaces.size} 表層)`);
  }
  return r.text;
}
