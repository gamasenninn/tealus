-- 048 タスクに番号 (docs/16、#661、2026-11-26 利用者「リストを見ながら番号で指示したい」)
-- ★ 人ごとに 1・2・3…。済みにしても変わらない (並びの位置ではない)。足すときに「その人の最大 + 1」
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS number INTEGER;
UPDATE tasks t SET number = n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY owner_id ORDER BY created_at, sort_order, id) AS rn FROM tasks) n
 WHERE t.id = n.id AND t.number IS NULL;
ALTER TABLE tasks ALTER COLUMN number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_owner_number ON tasks (owner_id, number);
