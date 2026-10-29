-- 次のログインでパスワードの変更を求める印 (2026-10-29 利用者判断、docs/02 users)。
-- ★ 管理者が決めた仮パスワードのまま使い続けられていた。管理者が作る・入れ直すときに立て、本人が変えたら落とす。
--   今いる利用者は false (変更を強いない)
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
