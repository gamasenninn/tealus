/**
 * 新着 (message:new) で部屋一覧を取り直すか。
 * ★ 管理者は全部屋の配信を受ける (見守りで入る) ので、自分の一覧に無い部屋の新着でも一覧を取り直していた
 *   (人の利用者の GET /api/rooms の 87% が管理者 1 人、1 便あたり最大 15 回。改善ループ 31)。
 *   自分が部屋に入ったときは room:added が取り直すので、一覧に無い部屋の新着では取り直さない
 */
export function shouldRefreshOnNewMessage(
  roomId: string | undefined,
  rooms: ReadonlyArray<{ id: string }>,
  { inflight = false, failed = false }: { inflight?: boolean; failed?: boolean } = {},
): boolean {
  if (!roomId) return true;
  // ★ 一覧に無くても取り直す場合 (改善ループ 32):
  //   - 取り直しの最中: 招かれた直後は room:added の取り直しが新着より先に読み終わることがある (まとめて 1 回だけ引き直される)
  //   - 前の取り直しが失敗していた: 以前は次の新着で治っていた
  if (inflight || failed) return true;
  return rooms.some((r) => r.id === roomId);
}
