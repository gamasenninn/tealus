-- #384 organon の pull を「いつ走ったか」記録する。
--
-- ★ なぜ要るか: 撤去 (retraction) の条件を「K 回続けて射影に無い」で判定したいが、
--   pull がいつ走ったかを **どこにも残していなかった**。updated_at の古さで代用すると、
--   pull が止まっていた期間まで「不在」に数えてしまう:
--
--     ttl が 10 日 変わらない → pull が走らない → 全行の updated_at が 10 日古いまま
--     11 日目に 1 語 deprecated → pull が走る → present な行だけ今に更新
--     → 消えた語は「3 日以上 不在」に見えるが、実際の不在は 1 回だけ
--
--   「pull が止まっていた期間は、不在の証拠にならない」。
--
-- ★★ 副産物: pull が止まっていること自体を引けるようになる。これまで気づける手掛かりは
--   「dictionary_terms.updated_at が片方だけ止まる」しかなかった (organon 班が 8/30 に発見)。
CREATE TABLE IF NOT EXISTS organon_sync_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at     timestamptz NOT NULL DEFAULT now(),
  terms      integer     NOT NULL,
  aliases    integer     NOT NULL,
  ttl_path   text
);

-- 「K 回前の pull」を引くだけなので、新しい順に辿れれば足りる。
CREATE INDEX IF NOT EXISTS idx_organon_sync_runs_ran_at ON organon_sync_runs (ran_at DESC);
