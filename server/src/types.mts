/**
 * server 共有型定義 (#330 TS 移行で導入)
 * 純粋な型のみを置く。runtime code は書かない (import type でのみ参照される)。
 */

/** users テーブルの role 3 class (#282) */
export type UserRole = 'admin' | 'user' | 'guest';

/** authenticate middleware が req.user に載せる認証済みユーザー */
export interface AuthUser {
  id: string;
  login_id: string;
  display_name: string;
  avatar_url: string | null;
  status_message: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
}
