-- メッセージ編集履歴
CREATE TABLE IF NOT EXISTS message_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
  version INT NOT NULL,
  content TEXT NOT NULL,
  edited_by UUID REFERENCES users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, version)
);

CREATE INDEX IF NOT EXISTS idx_message_edits_message ON message_edits(message_id, version DESC);

-- メッセージに編集済みフラグ
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;

-- ルーム設定（メッセージ編集ポリシー）
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS message_edit_policy VARCHAR(10) DEFAULT 'none';
