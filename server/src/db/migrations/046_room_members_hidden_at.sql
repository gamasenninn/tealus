-- 046 部屋を自分の一覧から隠す (#655、2026-11-24 サポート班の依頼・小野さん了承、docs/02 room_members)
-- ★ 各自が自分の分だけ。NULL = 隠していない。
-- ★ 隠した時刻より新しい投稿があれば一覧では隠していない扱いにする (戻すための書き込みはしない)
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
