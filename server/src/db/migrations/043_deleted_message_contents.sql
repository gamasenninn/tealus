-- 削除した投稿の本文の退避 (2026-10-30 利用者判断 3、docs/02 messages)。
-- ★ 削除で messages.content を null にしていたので、誤って消した本文が戻せず、誰が消したかも 14 日でログから消えた。
--   messages は今までどおり null にし (本文を読む口を変えない)、消す直前の本文と「誰が・いつ」をここに残す。
--   見る・戻すのは全体の管理者だけ
CREATE TABLE IF NOT EXISTS deleted_message_contents (
    message_id  UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    content     TEXT,
    deleted_by  UUID REFERENCES users(id),
    deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deleted_message_contents_deleted_at ON deleted_message_contents(deleted_at DESC);
