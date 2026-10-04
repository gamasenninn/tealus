-- #490 LINE から届いた便の「LINE の ID → Tealus の投稿」を記録する。
--
-- ★ なぜ要るか: LINE の引用返信は **引用元の ID (quotedMessageId) だけ**を送ってくる。本文は来ない。
--   届いた便の LINE の ID をどこにも残していなかったので、引用されても引き当てられず、
--   Tealus には返信の本文だけが届いていた (2026-10-04 に日付の無い返信を AI が聞き返した)。
--
-- ★ 画像のまとめ投稿 (#353) は LINE の便が複数で Tealus の投稿は 1 つ。なので PK は LINE の ID 側。
-- ★ room_id を持つのは、引き当てを同じ部屋に限るため (別の部屋の投稿を reply_to にしない)。
CREATE TABLE IF NOT EXISTS line_message_links (
  line_message_id text        PRIMARY KEY,
  message_id      uuid        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  room_id         uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_message_links_message_id ON line_message_links (message_id);
