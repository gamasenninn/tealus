/**
 * #488 リアクションの「自分が付けたか (me)」を、自分の ID で決める。
 *
 * ★ サーバーは以前、付けた本人の目線の me をそのまま全員に配っていた。付けていない人の画面でも
 *   「自分が付けた」と出て、それを押すと取り消しのつもりで自分のリアクションが増えた。
 * ★ 今は「誰が付けたか (user_ids)」が届く。user_ids が無い (古いサーバー) ときは me を信じず false にする
 *   (読み込み直せば履歴の API が正しい値を出す)。
 */
export interface IncomingReaction {
  emoji: string;
  count: number;
  user_ids?: string[];
  me?: boolean;
}

export function withMe<T extends IncomingReaction>(reactions: T[], myId: string | undefined): Array<T & { me: boolean }> {
  return reactions.map((r) => ({
    ...r,
    me: Array.isArray(r.user_ids) && !!myId ? r.user_ids.includes(myId) : false,
  }));
}
