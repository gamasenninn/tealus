-- #602 削除した部屋の添付を /media で開けなくする。
-- ★ 部屋を消すと messages / message_media が CASCADE で行ごと消え、「使っている投稿が全部削除されているか」
--   (#601) の判定に引っかからなかった。消す前に、その部屋の添付 (file_path / thumbnail_path) をここへ記録する。
--   ファイルそのものは消さない (メディアは消さない、10-10 の方針)
CREATE TABLE IF NOT EXISTS removed_media (
    file_path   TEXT PRIMARY KEY,
    removed_at  TIMESTAMPTZ DEFAULT now()
);
