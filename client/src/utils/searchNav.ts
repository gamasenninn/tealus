/**
 * #472 検索は寄り道 — 何件見比べても、← 2 回で元の部屋に戻る
 *
 * 検索結果から部屋へ行くとき、どの検索から来たかを history の state に残す。
 * その部屋で検索アイコンを押したら、検索画面を新しく積まずに前の検索画面へ戻る
 * (積むと、見比べた回数だけ ← を押さないと元の部屋に戻れなかった)。
 *
 * ★ URL の `?msg=` では判定しない。リンクで直接開いた部屋にも `?msg=` は付くが、
 *   その場合は戻る先の検索画面が履歴に無く、navigate(-1) で Tealus の外へ出てしまう。
 *   state は Tealus の中で遷移したときにしか付かないので、戻る先があることを保証できる。
 */

export interface SearchResultState {
  fromSearch: { roomId: string | null };
}

export type RoomSearchAction = { type: 'back' } | { type: 'open'; to: string };

/** 検索結果から部屋へ行くときの state。searchRoomId は部屋内検索ならその部屋、全体検索なら null */
export function searchResultState(searchRoomId: string | null): SearchResultState {
  return { fromSearch: { roomId: searchRoomId } };
}

/** 部屋の検索アイコンを押したときの動き */
export function roomSearchAction(state: unknown, roomId: string): RoomSearchAction {
  const from = (state as SearchResultState | null | undefined)?.fromSearch;
  // 部屋内検索の結果から来た同じ部屋だけ戻る。全体検索から来たときは部屋内検索を開く
  if (from && typeof from === 'object' && from.roomId === roomId) return { type: 'back' };
  return { type: 'open', to: `/search?room_id=${roomId}` };
}
