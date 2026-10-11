-- 語が最後に取り込みに出てきた時刻 (#569、2026-10-11)。
--
-- ★ なぜ要るか: 撤去の基準線 (#384「K 回続けて射影に居なかった」) は、upsertTerm が present な行に
--   必ず updated_at = NOW() を打つことを前提に、updated_at の古さで測っていた。
--   #547 で updated_at を「中身が変わったときだけ」進めるようにしたので、変わらない語が全部
--   「射影に居ない」に見えた (doctor が 333/333 を撤去待ちと誤報 / 撤去スクリプトの K 回の歯止めが外れた)。
--   → 「いつ変わったか」(updated_at) と「いつ見えたか」(seen_at) を別の列に分ける。
-- ★ 初期値は updated_at。射影に居る語は次の pull で今の時刻になる。
ALTER TABLE dictionary_terms ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;
UPDATE dictionary_terms SET seen_at = updated_at WHERE seen_at IS NULL;
