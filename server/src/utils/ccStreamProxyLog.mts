/**
 * `/agent-api` proxy の切断ログ (#359 B-1)
 *
 * ★ なぜ必要か: cc-stream の経路は
 *     client → Cloudflare → NAS(nginx) → 本体サーバ:3000 → /agent-api proxy → agent-server:4000
 *   で、agent-server は `subscriber removed` を書くが **3000 番は何も書かなかった**。
 *   8 月の切断調査で残った未計測層がここで、「3000 が無言」は
 *   **「何も起きていない」と「記録していない」の 2 通りに読めた**。
 *
 * ★★ この module がやるのは 1 つだけ ——「どちら側が先に閉じたか」を必ず書く。
 *   原因は書かない (分からないので)。分からないときは `unknown` と書く。
 *   **沈黙を残さない**のが目的なので、判定不能を沈黙で表してはいけない。
 *
 * ★★★ 同着を片側に潰さない (`side=both`)。同じ形の丸めで実損が半分になる事故を
 *   見張り / 手計算 / 集計 の 3 か所でやっている (2026-08-22)。
 */

export interface ProxyCloseFacts {
  /** 対象 URL (project 識別のため) */
  url: string;
  /** proxy がこの接続を受けた時刻 (ms) */
  startedAt: number;
  /** res が閉じた時刻 (ms) = ログを書く時刻 */
  now: number;
  /** 上流 (agent-server) 側が閉じた時刻 (ms)。無ければ未発生 */
  upstreamClosedAt?: number;
  /** 上流から下流へ流したバイト数。★ **書いた量**であって届いた量ではない */
  bytes: number;
  /** res を最後まで書き切れたか (`res.writableFinished`) */
  resFinished: boolean;
  /** proxy 自身が観測したエラー (ECONNRESET 等) */
  error?: string;
}

/**
 * ★ 下流が閉じた時刻は測らない (2026-08-23 に一度失敗した)。
 *
 * 初版は `req.on('close')` を使ったが、それは **リクエストを読み終えた時刻**で、
 * GET はボディが無いので即完了する。実測 3 本とも `client=+0.000s` になり、
 * side が常に client と出た。**測れないものを項目に置くと、確信のある嘘になる。**
 *
 * ★★ 向きの決め方は「上流が閉じてから res が閉じるまでの間隔」だけで組む:
 *
 * ```
 * upstream が閉じ、1 秒以上あいて res が閉じた   → upstream (下流はまだ生きていた)
 * upstream が一度も閉じずに res が閉じた         → client
 * 1 秒未満で連鎖した                            → unknown (撤去のカスケード。向きは決まらない)
 * ```
 *
 * ★★★ 1 秒は **ラベルにしか使わない**。件数にも判定にも使わない。
 *   実測の材料が増えたら見直す (2026-08-23 の 3 本は gap 59.78s で、境界から遠い)。
 */
const CASCADE_MS = 1000;

function decideSide(f: ProxyCloseFacts): string {
  const u = f.upstreamClosedAt;
  if (typeof u !== 'number') return 'client';
  const gap = f.now - u;
  // ★ 負の差 (上流が res より後に閉じた記録) は信用しない。順序が保証されない経路がある
  if (gap < 0) return 'unknown';
  return gap >= CASCADE_MS ? 'upstream' : 'unknown';
}

/** ms 差を「+N.NNNs」に。基準が無ければ `-` (= 0 秒と区別する) */
function offset(at: number | undefined, from: number): string {
  return typeof at === 'number' ? `+${((at - from) / 1000).toFixed(3)}s` : '-';
}

/**
 * 1 行にまとめる。**行頭は固定** (`[cc-stream proxy] closed: `) —— 既存の集計 grep を
 * 壊さないため。
 *
 * ★ `dur` / `upstream` / `bytes` は初版と同じ書式を保つ (2026-08-23 の 3 本と比較可能にする)。
 * ★★ `gap` を足したのは、Mac 側が今日これを手で引き算したから ——
 *   3 本の幅 0.059s が「60 秒の天井」の証拠になった。毎回引かせない。
 */
export function describeProxyClose(f: ProxyCloseFacts): string {
  const gap = typeof f.upstreamClosedAt === 'number'
    ? `${((f.now - f.upstreamClosedAt) / 1000).toFixed(3)}s`
    : '-';
  return `[cc-stream proxy] closed: url=${f.url} side=${decideSide(f)}`
    + ` dur=${((f.now - f.startedAt) / 1000).toFixed(3)}s bytes=${f.bytes}`
    + ` upstream=${offset(f.upstreamClosedAt, f.startedAt)} gap=${gap}`
    + ` res=${f.resFinished ? 'finished' : 'aborted'}`
    + ` err=${f.error ?? '-'}`;
}

/**
 * このリクエストを cc-stream の長時間接続として記録するか。
 *
 * ★ 全 API に付けると、通常の短命リクエストが 1 秒に何十行も出て、
 *   **見たい 1 日 4 件が埋もれる**。埋もれた計器は無いのと同じ。
 */
export function isCcStreamPath(url: string): boolean {
  return url.startsWith('/cc-queue/stream');
}
