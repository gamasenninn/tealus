-- 051 保留を区分にする (docs/16 §8-7、2026-11-28 02:56 利用者が決定)
-- ★ 状態 (status) の 'held' はあったが、画面から入れる口が無く使われていなかった。保留は区分の 5 つ目 (部屋の中のいちばん最後) にする
-- ★ held_at = 保留にした時刻 (画面に「保留 11/28〜」)。区分を保留に入れたときに入り、出したら消える
-- ★ 前の版のまま動いていても壊れない順: 列を足す → 状態の held を区分へ移す → 決まり (CHECK) を入れ替える
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;

UPDATE tasks SET section = 'held', status = 'open', held_at = COALESCE(held_at, updated_at) WHERE status = 'held';

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_section_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_section_check CHECK (section IN ('decide', 'do', 'waiting', 'later', 'held'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('open', 'done'));
