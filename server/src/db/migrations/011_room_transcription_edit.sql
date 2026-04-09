-- ルームごとの文字起こし編集権限設定
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS allow_member_transcription_edit BOOLEAN DEFAULT false;
