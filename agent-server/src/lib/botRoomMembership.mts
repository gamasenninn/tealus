/**
 * Bot (AI の口座) がその部屋にいるか (改善ループ 71、#649 B-5)。webhook の 3 つの口 (投稿・編集・文字起こし) で使う。
 * ★ 以前は同じ 15 行が 3 か所に写してあった (改善ループ 26 で「失敗をメンバーでないにしない」を 3 か所それぞれに入れた)。
 *
 * - 手元の一覧にあれば 'member'
 * - 無ければ本体から一覧を取り直し、手元の一覧を入れ替えてから判定する ('member' / 'not-member')
 * - 取り直しが失敗したら 'unknown' (★「メンバーでない」と分ける。呼び手は warn で残して、その便は扱わない)
 * - ★ 手元の一覧が空 (起動直後で一覧をまだ持っていない) なら確かめない ('member')。前からの振る舞い
 */
export type BotRoomCheck = 'member' | 'refreshed-member' | 'not-member' | 'unknown';

export async function ensureBotInRoom(
  ids: Set<string>, roomId: string, fetchRooms: () => Promise<{ rooms?: Array<{ id: string }> }>,
): Promise<{ result: BotRoomCheck; error?: string }> {
  if (ids.size === 0 || ids.has(roomId)) return { result: 'member' };
  try {
    const data = await fetchRooms();
    ids.clear();
    for (const r of data.rooms || []) ids.add(r.id);
    return { result: ids.has(roomId) ? 'refreshed-member' : 'not-member' };
  } catch (err) {
    return { result: 'unknown', error: err instanceof Error ? err.message : String(err) };
  }
}
