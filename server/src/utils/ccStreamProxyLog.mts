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
  /** ログを書く時刻 (ms) */
  now: number;
  /** 下流 (client / Cloudflare / nginx) 側が閉じた時刻 (ms)。無ければ未発生 */
  clientClosedAt?: number;
  /** 上流 (agent-server) 側が閉じた時刻 (ms)。無ければ未発生 */
  upstreamClosedAt?: number;
  /** 上流から下流へ流したバイト数 */
  bytes: number;
  /** proxy 自身が観測したエラー (ECONNRESET 等) */
  error?: string;
}

/** ms 差を「+N.NNNs」に。基準が無ければ `-` (= 0 秒と区別する) */
function offset(at: number | undefined, from: number): string {
  return typeof at === 'number' ? `+${((at - from) / 1000).toFixed(3)}s` : '-';
}

/**
 * どちら側が先に閉じたか。
 *
 * ★ error より **実際に閉じた側**を優先する。ECONNRESET は「相手が切った」結果として
 *   両側に出うるので、error だけを見ると発生源が分からない。
 */
function decideSide(f: ProxyCloseFacts): string {
  const c = f.clientClosedAt;
  const u = f.upstreamClosedAt;
  if (typeof c === 'number' && typeof u === 'number') {
    if (c < u) return 'client';
    if (u < c) return 'upstream';
    return 'both';
  }
  if (typeof c === 'number') return 'client';
  if (typeof u === 'number') return 'upstream';
  if (f.error) return 'error';
  return 'unknown';
}

/**
 * 1 行にまとめる。**行頭は固定** (`[cc-stream proxy] closed: `) —— 既存の集計 grep を
 * 壊さないため。項目を足すときは後ろに足すこと (Mac 側の `at=` と同じ約束)。
 */
export function describeProxyClose(f: ProxyCloseFacts): string {
  return `[cc-stream proxy] closed: url=${f.url} side=${decideSide(f)}`
    + ` dur=${((f.now - f.startedAt) / 1000).toFixed(3)}s bytes=${f.bytes}`
    + ` client=${offset(f.clientClosedAt, f.startedAt)}`
    + ` upstream=${offset(f.upstreamClosedAt, f.startedAt)}`
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
