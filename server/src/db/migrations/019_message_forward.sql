-- #166 メッセージ転送機能
-- messages テーブルに forwarded_from カラムを追加

ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from UUID REFERENCES messages(id);

CREATE INDEX IF NOT EXISTS idx_messages_forwarded_from ON messages(forwarded_from)
  WHERE forwarded_from IS NOT NULL;
