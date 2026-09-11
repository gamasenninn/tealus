/**
 * #423 応答の一生 (`response.created` → 終わり) を**記録に残す**ための読み分け (docs/08 §12)。
 *
 * ★ **これは直す道具ではない。測る道具である。**
 *   実測 (2026-09-05、通話履歴ルーム、session `d4fe50b8`) で、最後の音が鳴り終わって
 *   **161.5 秒**経ってから押した発話が `response_create_skipped` で断られ、
 *   利用者は 2 往復目を丸ごと落としたままセッションを閉じた。
 *
 * ★★ 門 (`realtimeResponseGate`) は `response.done` **だけ**を見て `active` を降ろす。
 *   だから戻らなかった理由の候補は 3 つあるが、**どれも記録が無いので測れない**:
 *   ```
 *   a  終わりの合図が届いていない (データチャネルで落ちた / そもそも来ない)
 *   b  ★ 門が見ていない**別の名前**で終わった → active が永久に立ったまま
 *   c  created と done の順序が入れ替わり、あとから来た created で立ち直した
 *   ```
 *   → ★★★ **門の挙動は変えない。** 分類だけ広く取って記録に落とし、次に出たときに
 *   `kind='finished'` なのに門が `active=true` のままなら **b が確定する**形にする。
 *
 * ★ 拾う範囲は `response.<名前>` の **2 段だけ**。子イベント (delta / output_item / 逐語) を
 *   混ぜると量が多すぎて読めず、しかも `response.output_audio_transcript.done` のように
 *   **`.done` で終わるのに応答の終わりではない**ものが紛れる (これを終わりと読むと門が早く開く)。
 */

/** 応答の一生の段。`unknown` = ★ 見たことのない `response.*` (候補 b の受け皿) */
export type ResponseLifecycleKind = 'created' | 'finished' | 'unknown';

/**
 * ★ 応答が終わったことを表す名前。**門が見ているのは `done` だけ**で、
 *   残りは「終わりのはずだが門は見ていない」= 記録に残す価値がある側。
 *   `cancelled` / `canceled` は綴りが揺れるので両方置く。
 */
const FINISHED_NAMES = new Set(['done', 'completed', 'incomplete', 'failed', 'cancelled', 'canceled']);

/**
 * サーバのイベント名から、応答の一生に関わるものだけを読み分ける。
 * 関係ないもの (子イベント / 他系統) は `null` = 記録しない。
 */
export function readResponseLifecycleEvent(type: string | undefined): ResponseLifecycleKind | null {
  if (!type) return null;
  const parts = type.split('.');
  // ★ 2 段ちょうど (`response.created`) だけ。3 段以上は子イベント、1 段は別物
  if (parts.length !== 2 || parts[0] !== 'response' || !parts[1]) return null;
  if (parts[1] === 'created') return 'created';
  return FINISHED_NAMES.has(parts[1]) ? 'finished' : 'unknown';
}
