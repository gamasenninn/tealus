-- #601 削除した投稿の添付を開けなくするため、/media の配信のたびにファイルの持ち主の投稿を引く。
-- ★ file_path / thumbnail_path には索引が無く、引くたびに全行 (本番 2.6 万行) を読むことになる
CREATE INDEX IF NOT EXISTS idx_message_media_file_path ON message_media(file_path);
CREATE INDEX IF NOT EXISTS idx_message_media_thumbnail_path ON message_media(thumbnail_path);
