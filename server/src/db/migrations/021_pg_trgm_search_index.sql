-- 021: pg_trgm extension + GIN index for ILIKE-based search acceleration
--
-- 動機: messages.content / voice_transcriptions.formatted_text / raw_text を対象に
-- ILIKE '%keyword%' 検索を行う /api/search および MCP search_messages の
-- 性能を改善する (Seq Scan → trigram index lookup)。
--
-- 効果想定: 100K rows で 200-350ms → 30-50ms (5-10x)。
-- 1M rows まで成長しても 100ms 圏内に収まる見込み。
--
-- リスク:
-- - GIN index 容量増 (推定 30-50MB / table)。許容範囲
-- - 書き込み時の index 更新コスト (微増)、但し messages 書き込みは
--   人間 + bot 経由でレートが知れているため実質影響なし
--
-- 冪等性: IF NOT EXISTS で既存スキップ。再実行可能。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON messages USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_voice_trans_formatted_trgm
  ON voice_transcriptions USING gin (formatted_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_voice_trans_raw_trgm
  ON voice_transcriptions USING gin (raw_text gin_trgm_ops);
