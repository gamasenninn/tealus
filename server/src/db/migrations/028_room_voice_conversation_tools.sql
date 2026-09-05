-- #405 会話モードでルームごとに上乗せする道具の名前 (docs/08 §12)
-- 例: ["execute_sql"] — そのルームに設定された MCP の道具を、名指しで会話モードに出す。
-- ★ 既定は空 = 何もしなければ 1 つも増えない。014_room_apps.sql の app_urls と同型。
-- ★ ここに置くのは、書き換えが requireRoomAdmin で守られているから
--   (room_settings.json 側の PUT は認証のみで、誰でも任意のルームを書き換えられる)。
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voice_conversation_tools JSONB DEFAULT '[]';
