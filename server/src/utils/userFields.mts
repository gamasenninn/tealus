/**
 * 利用者の表示名・ID の決まり (列の上限と同じ: users.display_name varchar(50) / login_id varchar(20))
 *
 * ★ 2026-10-29 改善ループ 24 回目: プロフィールの側 (#498) だけが確かめ、管理者が作る・直す口と最初の登録は
 *   そのまま INSERT していた。上限を超えると 500「サーバーエラー」、空白だけの表示名も通った
 */
export const DISPLAY_NAME_MAX = 50;
export const LOGIN_ID_MAX = 20;

/** 前後の空白を落とした表示名。決まりに合わなければ error */
export function checkDisplayName(v: unknown): { value: string } | { error: string } {
  if (typeof v !== 'string') return { error: '表示名は文字で入力してください' };
  const value = v.trim();
  if (!value) return { error: '表示名を入力してください' };
  if ([...value].length > DISPLAY_NAME_MAX) return { error: `表示名は ${DISPLAY_NAME_MAX} 文字以内で入力してください` };
  return { value };
}

/** ID の長さ (前後の空白は呼び出し側で落としてある) */
export function loginIdTooLong(loginId: string): string | null {
  return [...loginId].length > LOGIN_ID_MAX ? `ユーザーID は ${LOGIN_ID_MAX} 文字以内で入力してください` : null;
}
