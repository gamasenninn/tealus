-- メッセージ公開フラグ（お知らせ用）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;

-- 既存のお知らせメッセージは一括公開
UPDATE messages SET is_published = true
WHERE room_id IN (SELECT id FROM rooms WHERE is_announcement = true)
AND is_deleted = false AND type != 'system';
