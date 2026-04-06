-- Stamps: AIスタンプ生成＋スタンプパック機能

-- スタンプパック
CREATE TABLE IF NOT EXISTS stamp_packs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(50) NOT NULL,
    prompt        TEXT,
    created_by    UUID REFERENCES users(id),
    thumbnail_path TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- 個別スタンプ
CREATE TABLE IF NOT EXISTS stamps (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id       UUID NOT NULL REFERENCES stamp_packs(id) ON DELETE CASCADE,
    file_path     TEXT NOT NULL,
    label         VARCHAR(30),
    sort_order    INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_stamps_pack_id ON stamps(pack_id);
CREATE INDEX IF NOT EXISTS idx_stamp_packs_created_by ON stamp_packs(created_by);

-- last_used_at for pack ordering
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stamp_packs' AND column_name = 'last_used_at'
  ) THEN
    ALTER TABLE stamp_packs ADD COLUMN last_used_at TIMESTAMPTZ;
  END IF;
END $$;

-- messagesのtype制約にstampを追加
DO $$ BEGIN
  ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
  ALTER TABLE messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'system', 'voice', 'stamp'));
END $$;
