/**
 * 会話モードの計測記録を **離脱中に送る**ための詰め方。★ 純関数。
 *
 * ## ★★★★★ なぜ要るか (2026-09-18)
 *
 * ★ 利用者にとっていちばん痛いのは **「返ってこない回」**であって、遅さではない。
 * ★★ ところが記録がサーバへ飛ぶのは **3 つの場合だけ**だった:
 *   `stop()` (「会話を終える」を押した) / 接続の死を検知した / 待ち時間・上限で自動的に閉じた。
 * ★★★ **固まってリロードした / タブを閉じた回は、記録が 1 件も残らない。**
 *   → ★★★★ **いちばん困った回ほど証拠が無い。** 実測の 5.3% (95 往復中 5 回) は **下限**だった。
 *
 * ## ★ なぜ `sendBeacon` ではなく `keepalive` か
 *
 * ★★ 認証が `Authorization: Bearer` の **ヘッダ**なので、★★★ ヘッダを付けられない
 *   `navigator.sendBeacon` は使えない。★ `fetch(..., { keepalive: true })` はヘッダを付けられて、
 *   離脱をまたいで届く。
 *
 * ## ★★★★ なぜ詰めるのか
 *
 * ★ `keepalive` の本文には **64KB の上限**がある。★★ 実測で **いまの最大 1 便が 54,098 バイト**。
 *   ★★★ **もう上限に近い。** 長い会話ほど溢れる = **長く粘った回ほど落ちる**ので、放置できない。
 *
 * ★★★★ 捨てるのは **古い方から**。★ 固まった瞬間は **末尾**にあるので、末尾を守る。
 * ★★ 捨てた件数は返す —— **黙って減らすと「短い会話だった」と読める**。
 */

/** ★ 64KB の上限に対する余裕分。★★ ヘッダやサーバ側の包みのぶんを見込んで少なめに取る。 */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

export interface TrimResult {
  /** 実際に送る分 (★ 末尾を守って古い方から捨てたあと) */
  events: unknown[];
  /** 捨てた件数。★ 0 なら全部載っている */
  dropped: number;
  /** 送る本文のバイト数。★ 上限を超えていても隠さずに返す (1 件で超える場合) */
  bytes: number;
}

/** UTF-8 のバイト数。★ 文字数で測ると日本語で 3 倍ずれる。 */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function payloadBytes(sessionId: string, events: unknown[]): number {
  return byteLength(JSON.stringify({ session_id: sessionId, events }));
}

/**
 * 上限に収まるところまで **古い方から** 捨てる。
 *
 * ★ 収まるならそのまま返す (`dropped: 0`)。
 * ★★ 1 件だけにしても超えるなら、**その 1 件を送る** (捨て切らない)。
 *   ★★★ そのとき `bytes` は上限を超えたまま返す —— **呼び出し側が「入り切らなかった」と
 *   分かるようにする**ため。★ 0 を返して黙らせない。
 */
export function trimEventsForKeepalive(
  sessionId: string,
  events: unknown[],
  maxBytes: number = KEEPALIVE_MAX_BYTES,
): TrimResult {
  if (events.length === 0) return { events: [], dropped: 0, bytes: payloadBytes(sessionId, []) };

  let bytes = payloadBytes(sessionId, events);
  if (bytes <= maxBytes) return { events, dropped: 0, bytes };

  // ★ 二分探索で「末尾から何件なら載るか」を出す。★★ 1 件ずつ削ると長い会話で O(n^2) になる
  let lo = 1;              // ★ 最低 1 件は送る
  let hi = events.length;
  let best = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const tail = events.slice(events.length - mid);
    if (payloadBytes(sessionId, tail) <= maxBytes) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const kept = events.slice(events.length - best);
  bytes = payloadBytes(sessionId, kept);
  return { events: kept, dropped: events.length - kept.length, bytes };
}
