-- Tags: メッセージ/メディアへのタグ付け機能

-- タグマスタ（ルーム単位）
CREATE TABLE IF NOT EXISTS tags (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name        VARCHAR(50) NOT NULL,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(room_id, name)
);

-- メッセージ-タグ紐付け
CREATE TABLE IF NOT EXISTS message_tags (
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (message_id, tag_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_tags_room_id ON tags(room_id);
CREATE INDEX IF NOT EXISTS idx_message_tags_tag_id ON message_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_message_tags_message_id ON message_tags(message_id);
