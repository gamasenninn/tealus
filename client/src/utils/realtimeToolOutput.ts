/**
 * #432 道具の結果を Realtime に渡す。★ 例外を外に出さない。
 *
 * ★ 2026-10-09 00:09 KAIROS で、結果を送る send が大きすぎて例外を出し (68,444 バイト > 64KB)、
 *   道具の数を減らす所まで届かずに「調べています…」で固まった (09-13 の固まりも同じ形と見ている)。
 * ★ 送れなかったら、同じ call_id で短い「渡せなかった」を送る。モデルが「結果が来ない」まま待たずに、
 *   引き直しや謝りに進めるように。それも失敗したら諦めて結果だけ返す (呼び出し側は必ず数を減らす)。
 * ★ 大きさの上限は agent-server 側で先に切っている (voiceChatToolOutput.mts)。ここは最後の守り。
 */

export interface DeliverResult {
  ok: boolean;
  /** 送ろうとした文の大きさ (UTF-8 のバイト数)。記録用 */
  bytes: number;
  error?: string;
  /** 送れなかったとき、代わりの短い文を送れたか */
  fallbackSent?: boolean;
}

const FALLBACK_OUTPUT = '道具の結果が大きすぎて渡せませんでした。件数 (limit) を小さくするか、search_messages で絞って引き直してください。';

const itemOf = (callId: string, output: string) => ({
  type: 'conversation.item.create',
  item: { type: 'function_call_output', call_id: callId, output },
});

export function deliverToolOutput(send: (msg: unknown) => void, callId: string, output: string): DeliverResult {
  const msg = itemOf(callId, output);
  const bytes = new TextEncoder().encode(JSON.stringify(msg)).length;
  try {
    send(msg);
    return { ok: true, bytes };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    try {
      send(itemOf(callId, FALLBACK_OUTPUT));
      return { ok: false, bytes, error, fallbackSent: true };
    } catch {
      return { ok: false, bytes, error, fallbackSent: false };
    }
  }
}
