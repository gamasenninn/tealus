-- #595 見張りの鼓動。Tealus の部品 (tealus-cli など) が「生きている」を送る (docs/09 §3.2)。
--
-- ★ 送った人 (ログインした利用者) と名前の組ごとに 1 行。上書きするので増えない。
--   別の人が同じ名前で送っても、他人の鼓動にはならない (PK に user_id を入れる)。
-- ★ 見張りの「知らせの状態」は持たない (業務メモの投稿から引く)。鼓動だけは投稿ではないので、ここに覚える。
CREATE TABLE IF NOT EXISTS heartbeats (
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  last_seen  timestamptz NOT NULL DEFAULT now(),
  info       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, name)
);
