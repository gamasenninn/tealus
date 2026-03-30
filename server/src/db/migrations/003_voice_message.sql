-- Add 'voice' to messages type CHECK constraint
-- Drop and re-create the constraint
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'file', 'voice', 'system'));

-- Voice transcriptions table (for Step B onwards)
CREATE TABLE IF NOT EXISTS voice_transcriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
    version         INT NOT NULL DEFAULT 1,
    raw_text        TEXT,              -- Whisper output
    formatted_text  TEXT,              -- AI-formatted text
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'transcribing', 'formatting', 'done', 'error')),
    edited_by       UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_transcriptions_message ON voice_transcriptions(message_id, version DESC);
