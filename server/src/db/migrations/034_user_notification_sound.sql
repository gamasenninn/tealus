-- 通知音を鳴らすかをアカウントごとに選ぶ (2026-10-08)。
--
-- ★ なぜ要るか: それまでは端末ごとの保存 (localStorage) で、画面の中の音にしか効かなかった。
--   プッシュの音は OS の設定でしか止められず、「通知音を切ったのに鳴る」と言われた。
-- ★ 切った人へのメッセージの通知は silent で送る (通知そのものは出す)。通話の着信はこの列を見ない。
-- ★ 既定は鳴らす (true)。
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_sound boolean NOT NULL DEFAULT true;
