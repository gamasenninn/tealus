/**
 * 自分の利用者情報として返す列 (改善ループ 73、#649 B-7)。ログイン・登録・/me (認証のたびの読み込み) の 3 か所で使う。
 * ★ #532 (10-09) はログインの返事にだけ notification_sound が無く、入り直した直後の画面が「鳴らす」と見なした。
 *   同じ形で is_bot がログインと登録の返事に無かった。列を足すときはここだけ直す
 * ★ password_hash は入れない (ログインは照合のためにこの後ろへ足し、返す前に消す)
 */
export const SELF_USER_COLUMNS =
  'id, login_id, display_name, avatar_url, status_message, role, is_active, is_bot, notification_sound, must_change_password, created_at';
