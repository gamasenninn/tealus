/**
 * AI が道具 (tealus MCP の send_message) で、依頼された部屋へもう返事を送ったか (改善ループ 70、#649 B-4)。
 * 送っていれば、最後の自動の投稿を飛ばす (#292、2 通返さないため)。Light と Deep で使う。
 * ★ 以前は Light と Deep に同じ判定が別々に書いてあり、テストが 0 だった。
 * ★ tealus-mcp の send_message の返り値 ({"message":{"room_id":…}}) の形に頼っている。形が変わると黙って偽になるので、
 *   本番の記録と同じ形の例をテストに置いている
 */
export interface ToolCallItemLike {
  tool?: string;
  status?: string;
  result?: { content?: Array<{ text?: string } | unknown> } | null;
}

export function sentToOwnRoom(item: ToolCallItemLike | null | undefined, roomId: string): boolean {
  if (!item || item.tool !== 'send_message') return false;
  if (item.status && item.status !== 'completed') return false;
  try {
    const text = (item.result?.content?.[0] as { text?: string } | undefined)?.text;
    if (!text) return false;
    const parsed = JSON.parse(text) as { message?: { room_id?: unknown } };
    return parsed?.message?.room_id === roomId;
  } catch {
    return false;
  }
}
