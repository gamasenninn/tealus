/**
 * メッセージを直せるかの判定 (PUT /api/rooms/:id/messages/:msgId)。改善ループ 109 で道から出した。
 *
 * ★ 画面にも同じ規則の写しがある (client/src/hooks/useContextMenuItems.tsx・client/src/utils/voiceNav.ts)。
 *   ここを変えたら画面も合わせること (ずれるとメニューは出るのに保存で 403 になる)。
 * ★ policy が 'member' のときのメンバー確認は DB を引くので呼び出し側でする (needsMemberCheck)。
 * ★ 知らない policy 値はどの枝にも当たらず通る (道の中にあったときの動きのまま)。
 */
export interface MessageEditInput {
  isDeleted: boolean;
  type: string;
  /** 今の本文があるか (無い便への最初の説明文は編集ではない) */
  hasContent: boolean;
  /** 直そうとしている人が送り主か */
  isOwn: boolean;
  /** rooms.message_edit_policy (none / sender / member) */
  policy: string;
}

export type MessageEditDecision =
  | { ok: true; needsMemberCheck: boolean }
  | { ok: false; status: 400 | 403; error: string };

export function decideMessageEdit({ isDeleted, type, hasContent, isOwn, policy }: MessageEditInput): MessageEditDecision {
  if (isDeleted) return { ok: false, status: 400, error: '削除済みメッセージは編集できません' };
  if (type === 'system' || type === 'stamp') return { ok: false, status: 400, error: 'このメッセージは編集できません' };

  // 初回キャプション追加 (本文が無く送り主本人) は常に許可
  if (!hasContent && isOwn) return { ok: true, needsMemberCheck: false };

  if (policy === 'none') return { ok: false, status: 403, error: 'このルームではメッセージ編集が許可されていません' };
  if (policy === 'sender' && !isOwn) return { ok: false, status: 403, error: '送信者のみ編集できます' };
  return { ok: true, needsMemberCheck: policy === 'member' };
}
