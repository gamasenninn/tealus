/**
 * #542 部屋ごとの「表示 (agent:status) を出した順番」。
 *
 * ★ 受付エコー (ccQueue の emitCcAck) は 5 秒後に idle を出して自分の表示を消す。その間に同じ部屋で
 *   アシスタントが「考え中」を出していても上書きして消していた (`@アシスタント @cc-x` の便)。
 *   idle を出す前に、自分の後に誰かが表示を出したかをこの番号で確かめる
 */
const seqByRoom = new Map<string, number>();

/** 表示を出した (botApi.pushStatus が呼ぶ) */
export function bumpStatusSeq(roomId: string): void {
  seqByRoom.set(roomId, (seqByRoom.get(roomId) ?? 0) + 1);
}

/** いまの番号 */
export function statusSeqOf(roomId: string): number {
  return seqByRoom.get(roomId) ?? 0;
}
