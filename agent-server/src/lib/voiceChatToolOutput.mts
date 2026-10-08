/**
 * #432 会話モードの道具の返り値に、大きさの上限を付ける。
 *
 * ★ 画面は返り値をデータチャネルで Realtime に送る (`conversation.item.create` に JSON.stringify で包む)。
 *   データチャネルが 1 回に送れる大きさは、相手が知らせてこないと 64KB とみなされ、超えると send が例外を出す。
 * ★★ 2026-10-09 00:09 KAIROS で、get_messages (既定 20 本) の送る文が 68,444 バイトになり、
 *   send の例外で道具の数が減らず「調べています…」が消えなくなった (09-13 の固まりも KAIROS)。
 * ★ 上限は「包んだあとの大きさ」で見る。返り値自体が JSON なので、包むと引用符・改行の逃がしで膨らむ。
 *   64KB ちょうどではなく余白を取る (包みの外側の項目と、相手の数え方の違いの分)。
 */

/** 画面が送る文 (包んだあと) の上限。64KB に対して余白を取る */
export const TOOL_OUTPUT_WIRE_LIMIT = 48 * 1024;

/** 包みの外側 (type・item・call_id など) の分。実際は 100 バイト前後 */
const ENVELOPE_BYTES = 200;

const wireBytesOf = (s: string): number => Buffer.byteLength(JSON.stringify(s), 'utf8') + ENVELOPE_BYTES;

const noteOf = (originalBytes: number): string =>
  `\n\n（道具の結果が長すぎるため、ここで切りました。元は約 ${Math.round(originalBytes / 1024)}KB です。`
  + '続きが要るときは limit を小さくして引き直すか、search_messages で絞ってください）';

export interface CappedOutput {
  output: string;
  truncated: boolean;
  /** 切る前の返り値の大きさ (UTF-8 のバイト数)。記録用 */
  originalBytes: number;
}

/**
 * 返り値が上限に収まればそのまま、超えれば頭から収まるところまで残して切り、切ったことを添える。
 * ★ 頭から残すのは、get_messages が新しい投稿を先に返すため。
 */
export function capToolOutput(output: string, limit: number = TOOL_OUTPUT_WIRE_LIMIT): CappedOutput {
  const originalBytes = Buffer.byteLength(output, 'utf8');
  if (wireBytesOf(output) <= limit) return { output, truncated: false, originalBytes };

  const note = noteOf(originalBytes);
  // 収まる長さ (文字数) を二分探索で探す
  let lo = 0;
  let hi = output.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (wireBytesOf(output.slice(0, mid) + note) <= limit) lo = mid;
    else hi = mid - 1;
  }
  let cut = lo;
  // サロゲートペア (絵文字など) の片割れを残さない
  if (cut > 0 && /[\uD800-\uDBFF]/.test(output[cut - 1])) cut -= 1;
  return { output: output.slice(0, cut) + note, truncated: true, originalBytes };
}
