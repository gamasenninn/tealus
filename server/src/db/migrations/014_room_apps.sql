-- ルームごとのアプリURL（複数対応、JSON）
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS app_urls JSONB DEFAULT '[]';
