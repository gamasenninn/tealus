-- #405 ルームごとの Realtime 音声会話モードの可否 (docs/08 §4.1 / §12)
-- 既定 false = 何もしなければ開かない。開けたルームにだけヘッダーに入口が出る。
-- 全ルーム解放にしない根拠は docs/08 §4 の理由② (未知の失敗はその 1 ルームで止める)。
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voice_conversation_enabled BOOLEAN DEFAULT false;
