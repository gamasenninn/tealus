-- #336 汎用フォーム primitive: messages.type に 'form' を追加。
-- フォーム定義は content 内の fenced ```tealus-form JSON に埋め込む方式のため
-- スキーマ変更は type CHECK 制約の拡張のみ (008_stamps.sql と同型の冪等 DDL)。
DO $$ BEGIN
  ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
  ALTER TABLE messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'system', 'voice', 'stamp', 'form'));
END $$;
