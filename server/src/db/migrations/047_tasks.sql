-- 047 タスク一覧 (docs/16、#661、2026-11-26 利用者の判断)
-- ★ 会話から AI がまとめた「人のやること」の 1 件 1 件。メッセージの TODO タグ (018) とは単位が違う
-- ★ 一覧は人のもの (owner_id)。部屋は「何の話か」の括り (room_id、NULL = 部屋なし)
-- ★ 済みにするのは人。AI は ai_suggests_done を立てるところまで (docs/16 §4.3)
-- ★ 足すだけ (他の表は変えない)
CREATE TABLE IF NOT EXISTS tasks (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id            UUID REFERENCES rooms(id) ON DELETE SET NULL,
    title              TEXT NOT NULL,
    note               TEXT,
    section            VARCHAR(16) NOT NULL DEFAULT 'do'
                       CHECK (section IN ('decide', 'do', 'waiting', 'later')),
    status             VARCHAR(16) NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'done', 'held')),
    source_message_ids UUID[] NOT NULL DEFAULT '{}',
    ai_suggests_done   BOOLEAN NOT NULL DEFAULT false,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    done_at            TIMESTAMPTZ,
    done_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 一覧はいつも「その人の・残り」を引く
CREATE INDEX IF NOT EXISTS idx_tasks_owner_status ON tasks (owner_id, status);
