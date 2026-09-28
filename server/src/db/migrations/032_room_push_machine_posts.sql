-- #463 機械 (is_bot) の投稿でも通知を鳴らすかを、ルームごとに管理者が選ぶ。
--
-- ★ なぜルームごとか: 機械の流れは量がルームで大きく違う (14 日実測: トランシーバー履歴 1 日 57 件・12 人、
--   通話履歴 33 件・8 人、出品写真・動画 18 件・4 人)。全部を既定で鳴らすと、トランシーバー履歴の 12 人は
--   各自がオフにするまで 1 日 57 件鳴らされる。鳴らしたいルームだけ管理者が開ける (利用者判断 2026-09-28)。
-- ★ 既定は鳴らさない (false) = 今までと同じ。各自の room_members.push_muted がこれより優先する。
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS push_machine_posts boolean NOT NULL DEFAULT false;
