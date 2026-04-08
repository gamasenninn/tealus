-- Webhook設定テーブル
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,  -- NULL = 全ルーム対象
  url TEXT NOT NULL,
  secret TEXT,                                            -- HMAC署名用シークレット
  events TEXT[] NOT NULL DEFAULT '{message.created}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
