-- ☆ で固定したエージェントへの指示 (2026-11-01 利用者判断、docs/02 prompt_pins)。
-- ★ 指示の履歴 (#354) は messages を新しい順に 200 件さかのぼって 30 件出すだけなので、毎回違う文を送る部屋では
--   古い大事な指示が押し出されていた (業務メモ 282 件中 266 種類)。☆ を付けたものだけをここに覚え、履歴の上に出す
CREATE TABLE IF NOT EXISTS prompt_pins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, room_id, content)
);
