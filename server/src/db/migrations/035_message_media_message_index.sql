-- 添付をメッセージから引くための索引 (#549、2026-10-10)。
--
-- ★ なぜ要るか: 添付はいつも WHERE message_id = ANY(...) で引く (メッセージの取得・お知らせ・bot の口)。
--   主キーしか無く、毎回全行を読んでいた (2026-10-10 に 25,303 行 × 137,093 回。行は月 +28%)。
-- ★ 本番の 2.5 万行なら作るのは一瞬。CONCURRENTLY は migrate のトランザクションの中では使えないので付けない。
CREATE INDEX IF NOT EXISTS idx_message_media_message ON message_media(message_id);
