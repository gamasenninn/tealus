import { getIo } from '../io-registry.mts';

/**
 * #486 人が部屋に入ったことを、その人の接続に反映して本人に知らせる。
 *
 * ★ 各端末は接続時の部屋の一覧についてだけ room:join する。あとから入った部屋 (グループ作成・1 対 1・
 *   メンバー追加・ボットの参加) は登録されず、読み込み直すまで部屋も投稿も届かなかった。
 *   管理者は接続時に全部屋を受信するので、管理者の画面では起きない (気づかれなかった理由)。
 * ★ 出るときは呼び出し側が socketsLeave している (members.mts)。ここは入るときだけ。
 */
export function announceRoomJoined(roomId: string, userIds: string[]): void {
  const io = getIo();
  for (const userId of new Set(userIds)) {
    io.in(`user:${userId}`).socketsJoin(roomId);
    io.to(`user:${userId}`).emit('room:added', { room_id: roomId });
  }
}

/**
 * #489 部屋の情報・メンバーが変わったことを、部屋のメンバーに知らせる。
 *
 * ★ 知らせが無く、部屋を開いている人は読み込み直すまで古いままだった
 *   (「メッセージ編集」を許可しても編集が出ない / 誰かが抜けても見出しの人数が変わらない)。
 * ★ 中身は部屋の ID だけ。受け手が取り直す (設定の値をここで配ると、見る人ごとの権限の判断を二重に持つことになる)。
 * ★ 抜けた人へは届かない (呼び出し側が先に socketsLeave している)。
 */
export function announceRoomUpdated(roomId: string): void {
  getIo().to(roomId).emit('room:updated', { room_id: roomId });
}
