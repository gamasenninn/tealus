/**
 * 部屋の「表示」(agent:status、考え中・届きました など) を配る 1 か所 (#650、docs/14 §5.4、2026-11-23)。
 *
 * ★ 画面は部屋ごとに表示を 1 つしか持たず、**誰の idle でも消す** (client/src/hooks/useSocketSync.ts の handleAgentStatus は
 *   agent_id を見ない)。だから「届きました」を 5 秒後に消す idle は、自分の後に誰も表示を出していないときだけ出す (#542)。
 *   その番号を本体で持つ: 表示はすべてここを通る (POST /api/bot/status と、本体の cc の受け付け)。
 *   以前は agent-server のメモリにあり (lib/statusSeq.mts)、アシスタント自身の表示しか数えられなかった
 */
import { getIo } from '../io-registry.mts';

export interface AgentStatusPayload {
  agent_id: string;
  status: string;
  message: string;
  display_name: string;
}

const seqByRoom = new Map<string, number>();

/** いまの番号 (表示を出すたびに 1 進む) */
export function statusSeqOf(roomId: string): number {
  return seqByRoom.get(roomId) ?? 0;
}

/** 部屋に表示を配り、番号を進める */
export function emitAgentStatus(roomId: string, p: AgentStatusPayload): void {
  seqByRoom.set(roomId, statusSeqOf(roomId) + 1);
  getIo().to(roomId).emit('agent:status', { agent_id: p.agent_id, room_id: roomId, status: p.status, message: p.message, display_name: p.display_name });
}

/** テスト用 */
export function _resetStatusSeq(): void {
  seqByRoom.clear();
}
