-- 049 タスクの番号を会社全体の通し番号にする (docs/16 §8-5、#661、2026-11-26 18:47 利用者「番号は行為の ID。個人でもグループでも唯一」)
-- ★ 048 は人ごとの「最大 + 1」だった。共有すると「3 番」が何人分も並ぶ・持ち主が変わると番号が変わる・一番大きい番号を消すと使い回す
-- ★ 振り直しは作った順。切り替えた時点の本番は 1 人分の 1〜15 で、作った順と同じなので番号は変わらない
CREATE SEQUENCE IF NOT EXISTS tasks_number_seq;
DROP INDEX IF EXISTS uq_tasks_owner_number;
UPDATE tasks t SET number = n.rn
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, owner_id, number, id) AS rn FROM tasks) n
 WHERE t.id = n.id AND t.number <> n.rn;
SELECT setval('tasks_number_seq', GREATEST((SELECT COALESCE(MAX(number), 0) FROM tasks), 1), (SELECT COUNT(*) > 0 FROM tasks));
ALTER SEQUENCE tasks_number_seq OWNED BY tasks.number;
ALTER TABLE tasks ALTER COLUMN number SET DEFAULT nextval('tasks_number_seq');
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_number ON tasks (number);
