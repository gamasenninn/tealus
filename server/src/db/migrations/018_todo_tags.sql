-- TODO タグ機能: 既存タグシステムを拡張
-- tags テーブルに is_todo フラグ、message_tags テーブルに完了状態と優先度を追加

-- 1. tags テーブル: TODO タグの区別
ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_todo BOOLEAN DEFAULT false;

-- 2. message_tags テーブル: 完了状態 + 重要度
ALTER TABLE message_tags ADD COLUMN IF NOT EXISTS is_done BOOLEAN DEFAULT false;
ALTER TABLE message_tags ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- 3. 既存ルームにデフォルト TODO タグを一括追加
INSERT INTO tags (room_id, name, is_todo, created_by)
SELECT r.id, 'TODO', true, (SELECT id FROM users LIMIT 1)
FROM rooms r
WHERE NOT EXISTS (SELECT 1 FROM tags t WHERE t.room_id = r.id AND t.name = 'TODO');
