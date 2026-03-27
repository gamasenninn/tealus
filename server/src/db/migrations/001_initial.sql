-- Life Line: Initial Schema
-- Phase 1 tables

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- users
-- ============================================
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id   VARCHAR(20) UNIQUE NOT NULL,
    display_name  VARCHAR(50) NOT NULL,
    avatar_url    TEXT,
    status_message VARCHAR(100),
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN DEFAULT true,
    last_seen_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- rooms
-- ============================================
CREATE TABLE rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'group')),
    name        VARCHAR(100),
    icon_url    TEXT,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- room_members
-- ============================================
CREATE TABLE room_members (
    room_id     UUID REFERENCES rooms(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(10) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    nickname    VARCHAR(50),
    joined_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);

-- ============================================
-- messages
-- ============================================
CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
    sender_id   UUID REFERENCES users(id) NOT NULL,
    content     TEXT,
    type        VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'file', 'system')),
    reply_to    UUID REFERENCES messages(id),
    is_deleted  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_room_created ON messages(room_id, created_at DESC);
CREATE INDEX idx_messages_reply_to ON messages(reply_to) WHERE reply_to IS NOT NULL;

-- ============================================
-- message_media
-- ============================================
CREATE TABLE message_media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
    file_path       TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    file_size       BIGINT NOT NULL,
    width           INT,
    height          INT,
    thumbnail_path  TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- room_read_cursors (unread count for room list)
-- ============================================
CREATE TABLE room_read_cursors (
    room_id              UUID REFERENCES rooms(id) ON DELETE CASCADE,
    user_id              UUID REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id UUID REFERENCES messages(id),
    last_read_at         TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);

-- ============================================
-- message_reads (read count for chat view)
-- ============================================
CREATE TABLE message_reads (
    message_id  UUID REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    read_at     TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_message_reads_message ON message_reads(message_id);

-- ============================================
-- push_subscriptions
-- ============================================
CREATE TABLE push_subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    endpoint    TEXT NOT NULL,
    p256dh_key  TEXT NOT NULL,
    auth_key    TEXT NOT NULL,
    device_name VARCHAR(100),
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, endpoint)
);

-- ============================================
-- RLS Policies
-- ============================================

-- messages: only visible to room members
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select ON messages
    FOR SELECT USING (
        room_id IN (
            SELECT room_id FROM room_members
            WHERE user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY messages_insert ON messages
    FOR INSERT WITH CHECK (
        room_id IN (
            SELECT room_id FROM room_members
            WHERE user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- room_members: only visible to fellow room members
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY room_members_select ON room_members
    FOR SELECT USING (
        room_id IN (
            SELECT rm.room_id FROM room_members rm
            WHERE rm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- message_reads: only visible to room members
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_reads_select ON message_reads
    FOR SELECT USING (
        message_id IN (
            SELECT m.id FROM messages m
            JOIN room_members rm ON rm.room_id = m.room_id
            WHERE rm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );
