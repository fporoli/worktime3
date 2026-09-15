--liquibase formatted sql

-- One row per (recipient, event) rather than a single jsonb blob on `workflows` — a
-- team-assigned workflow step must notify every team member independently, each with
-- their own read state, which a single column on the workflow row can't represent.
-- This table is the persisted source of truth; NotificationsGateway (WebSocket) only
-- pushes a live copy of a row that already exists here, so a missed push is never a
-- lost notification, only a delayed one.

--changeset worktime:046-notifications
CREATE TABLE notifications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    recipient_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                TEXT NOT NULL,
    title               TEXT NOT NULL,
    body                TEXT,
    source_table        TEXT NOT NULL,
    source_table_uuid   UUID NOT NULL,
    workflow_id         UUID REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    data                JSONB NOT NULL DEFAULT '{}',
    read_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bell dropdown: newest first, scoped to the caller.
CREATE INDEX idx_notifications_recipient_created ON notifications(recipient_user_id, created_at DESC);
-- Unread-badge count: partial index keeps it cheap as history grows.
CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_user_id) WHERE read_at IS NULL;
