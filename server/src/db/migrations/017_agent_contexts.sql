-- エージェントコンテキスト管理
CREATE TABLE IF NOT EXISTS agent_contexts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id         UUID REFERENCES users(id) NOT NULL,
    room_id          UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
    session_id       TEXT,
    workspace_path   TEXT NOT NULL,
    status           VARCHAR(20) DEFAULT 'idle'
                     CHECK (status IN ('idle', 'processing', 'error')),
    last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_contexts_agent_room
    ON agent_contexts(agent_id, room_id);
