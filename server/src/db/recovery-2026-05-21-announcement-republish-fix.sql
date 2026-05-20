-- ============================================================
-- 復旧 SQL: 2026-05-21 announcement message 誤公開の reset
--
-- 背景:
-- migration 016 (= message_published、2026-04 追加) の 2 番目の UPDATE 句が
-- migrate.js (history tracking なし、毎回全 .sql 再実行) で毎回再実行され、
-- お知らせルーム内の全 message を is_published=true に書き戻す bug があった。
--
-- 2026-05-21 user 報告で発覚 (= migration 022 適用のため migrate 再実行 → 全
-- announcement message が誤公開)。本復旧 SQL で全お知らせ message を
-- is_published=false に reset、user は手動でピックアップしたい message を
-- 再選択する path。
--
-- migration 016 の問題 UPDATE 句は同日 (2026-05-21) に削除済、本復旧 SQL は
-- 1 回実行で完了 (= migration に組み込むと migrate 再実行で user の再 pick up
-- が消えるため、manual SQL として置く)。
--
-- 実行方法 (本体 server に migration と同 DB credentials で接続):
--
--   psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME \
--     -f src/db/recovery-2026-05-21-announcement-republish-fix.sql
--
-- または docker compose 環境なら:
--
--   docker compose exec -T postgres psql -U tealus -d tealus \
--     < server/src/db/recovery-2026-05-21-announcement-republish-fix.sql
--
-- 実行後、影響件数が表示される。確認のため別途:
--
--   SELECT COUNT(*) FROM messages
--   WHERE room_id IN (SELECT id FROM rooms WHERE is_announcement = true)
--     AND is_published = true;
--
-- で残件が 0 か確認可能 (= user が再 pick up する前は 0、再 pick up したら増加)。
-- ============================================================

UPDATE messages SET is_published = false
WHERE room_id IN (SELECT id FROM rooms WHERE is_announcement = true)
  AND is_deleted = false
  AND type != 'system'
  AND is_published = true;

-- 影響件数を report
SELECT COUNT(*) AS reset_count
FROM messages
WHERE room_id IN (SELECT id FROM rooms WHERE is_announcement = true)
  AND is_deleted = false
  AND type != 'system'
  AND is_published = false;
