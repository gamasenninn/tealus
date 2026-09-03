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
  /**
   * リクエストの User-Agent。★ **3 本を分ける唯一の鍵** (2026-09-02)
   *
   * url に載るのは project だけで、probe-b / probe-c / 本線が全部 `tealus-dev` になる。
   * 時刻で対応づける必要が無くなるので、`side` の 1 秒ラベルと違って取り違えようがない。
   *
   * ★★ 送り手側の実測 (2026-09-02 07:05 に Mac セッションが訂正):
   * ```
   * probe-c   -A cc-probe-c   → ua=cc-probe-c
   * probe-b   ★ UA を送らない → ua=-
   * 本線      ★ UA を送らない → ua=-   ← ★★★ probe-b と区別が付かない
   * ```
   * → **`ua=-` は 1 本を指さない。** 本線に `-A cc-main` が入って初めて 3 本に分かれる。
   *   最初の申告は「probe が UA を送る」だったが、それは probe-c だけの話だった。
   *   **この module は送り手を知らない。`ua=-` を「本線」と読む規則をここに書かないこと。**
   */
  ua?: string;
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

/** ua の上限。★ 長さは行の読みやすさ側の都合で、判定には使わない */
const UA_MAX = 64;

/**
 * UA は **クライアントが自由に決める文字列**なので、そのまま行に載せない。
 *
 * ★ この行は空白区切りの key=value で読まれる。生の UA を通すと
 *   `User-Agent: evil side=upstream x` の 1 本で **偽の `side=` を注入できる**。
 *   改行を含めれば `[cc-stream proxy] closed: ...` の行ごと偽造できる。
 *   計器は読み手に嘘をつかせない側に倒す —— **空白系も `=` も潰す**。
 *
 * ★★★ `=` まで潰すのは、空白だけでは足りなかったから。空白を `_` にすると
 *   **フィールドとしては割れなくなる**が、`ua=evil_side=upstream_x` の中に
 *   文字列 `side=` が残る。読み手は `grep -o 'side=[a-z]*'` で数えるので、
 *   **1 本の接続が 2 本に化ける**。値の中に `=` を残さなければ、行の中の `=` は
 *   フィールド区切りだけになる (probe の UA は `cc-probe-b` なので実害の損は無い)。
 *
 * ★★ 無い / 空はどちらも `-` に倒す (「送っていない」と「空で送った」を分ける必要は無い)。
 *   ★★★ `-` が**どの接続かは、この行だけでは決まらない**。送り手側の構成に依る。
 */
function sanitizeUa(ua: string | undefined): string {
  if (!ua) return '-';
  const flat = ua.replace(/[\s=]+/g, '_').slice(0, UA_MAX);
  return flat === '' ? '-' : flat;
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
    // ★ ua は err の**手前**。err (`read ECONNRESET`) は空白を含むので末尾に置いたままにする
    + ` ua=${sanitizeUa(f.ua)}`
    + ` err=${f.error ?? '-'}`;
}

/**
 * 上流が消えたら下流も即座に閉じる (#359、2026-08-23 の実測から)。
 *
 * ★ なぜ要るか: 放っておくと **60 秒** かかる。
 *   nginx (NAS) の `proxy_read_timeout` は 60s で、ふだんは 15 秒ごとの heartbeat が
 *   それを抑えている (docs/05 §4)。**heartbeat を出している agent-server が死ぬと
 *   抑えが外れる** —— proxy は上流の死に気づかず、nginx が 60 秒で切るまで
 *   クライアントを「死んだ上流に繋がったまま」にしておく。
 *
 * ★★ 実測 (agent-server 再起動、3 本): 保持 59.783 / 59.784 / 59.842 秒。
 *   同じ日の server 再起動 (proxy 自身が落ちる) は 1 秒で撤去され、空白は 19 秒だった。
 *   **同じ「予告つき再起動」で 3.5 倍の差**が付いていた。
 *
 * ★★★ `end()` であって `destroy()` ではない。NDJSON の行境界を壊さずに EOF を伝え、
 *   クライアントの再接続ループにそのまま渡す。
 *
 * @returns 実際に閉じたか (既に終わっていた / 閉じられなかった場合は false)
 */
export function endDownstream(res: { writableEnded: boolean; end(): void }): boolean {
  if (res.writableEnded) return false;
  try {
    res.end();
    return true;
  } catch {
    // 既に破棄されている等。切断処理の中なので、ここで投げても誰も得をしない
    return false;
  }
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
