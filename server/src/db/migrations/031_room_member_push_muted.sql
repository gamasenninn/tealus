-- #463 ルームごとに通知を鳴らさないようにする (各自が選ぶ)。
--
-- ★ なぜ要るか: 通知はなるべく鳴らしたい (利用者判断) が、機械の流れ (トランシーバー 1 日 55 件など) まで
--   鳴らすと、止める手段が OS で Tealus の通知を丸ごと切ることしかなく、人からの通知まで消える。
--   LINE で通知が多くても平気なのは、うるさいトークだけを自分で通知オフにできるから。
-- ★ 既定は鳴らす (false)。通話の着信はこの列を見ない。
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS push_muted boolean NOT NULL DEFAULT false;
