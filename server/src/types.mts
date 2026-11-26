/**
 * server 共有型定義 (#330 TS 移行で導入)
 * 純粋な型のみを置く。runtime code は書かない (import type でのみ参照される)。
 */

/** users テーブルの role 3 class (#282) */
export type UserRole = 'admin' | 'user' | 'guest';

/** Socket.IO 認証 middleware が socket.user に載せるユーザー (SELECT 列に対応) */
export type SocketUser = Pick<AuthUser, 'id' | 'login_id' | 'display_name' | 'avatar_url' | 'role'>;

/** authenticate middleware が req.user に載せる認証済みユーザー */
export interface AuthUser {
  id: string;
  login_id: string;
  display_name: string;
  avatar_url: string | null;
  status_message: string | null;
  role: UserRole;
  is_active: boolean;
  /** 機械のアカウント (エージェント・ボット・トランシーバー)。★ 2026-09-27 通知の判定に使うため認証で読むようにした */
  is_bot?: boolean;
  /** メッセージの通知で音を鳴らす (アカウントごと、2026-10-08)。切るとプッシュは silent で送る */
  notification_sound?: boolean;
  /** 次のログインでパスワードの変更を求める (042、2026-10-29 docs/02)。画面が変更の画面だけを出す */
  must_change_password?: boolean;
  created_at: Date;
}

/**
 * message_media の行 (001_initial.sql)。改善ループ 123 で 5 か所の写しをここに 1 つにした。
 * ★ file_size は BIGINT なので pg は string で返す (number ではない)。file_name・mime_type は NOT NULL
 */
export interface MediaRow {
  id: string;
  message_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: string;
  width: number | null;
  height: number | null;
  thumbnail_path: string | null;
  created_at: Date;
}
