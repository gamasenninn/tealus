-- ルームのお知らせフラグ（ホーム画面に表示されるルーム）
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_announcement BOOLEAN DEFAULT false;
