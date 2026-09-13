--liquibase formatted sql

-- Generic per-record version history: one row per (table, table_uuid) tracked
-- entity, holding the current version_nr plus a full history[] of past
-- actions (insert / update / update_delta / delete), each with its own
-- version number, actor and a snapshot/delta of the record at that point.
--
-- table_uuid (and last_modified_by_workflow_uuid, once a workflows table
-- exists) are deliberately plain UUID columns with no FK — this table is
-- polymorphic across every other table in the schema, so referential
-- integrity for "which record" can't be enforced at the DB level here.
-- "table" is a reserved word, so it's quoted throughout (same as
-- static_data."values").

--changeset worktime:033-versions
CREATE TABLE versions (
    version_uuid                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "table"                         TEXT NOT NULL,
    table_uuid                      UUID NOT NULL,
    version_nr                      INTEGER NOT NULL DEFAULT 1,
    created                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_uuid            UUID REFERENCES users(id) ON DELETE SET NULL,
    lastmodified                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lastmodified_by_user_uuid       UUID REFERENCES users(id) ON DELETE SET NULL,
    last_modified_by_workflow_uuid  UUID,
    -- Array of {version, action, actioned_by_user_uuid, actioned_date, record}.
    -- action is one of: insert / update / update_delta / delete.
    history                         JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT chk_versions_version_nr_positive CHECK (version_nr >= 1)
);

CREATE UNIQUE INDEX uq_versions_table_record ON versions("table", table_uuid);

COMMENT ON TABLE versions IS 'Generic version/history tracking for records in any other table, keyed by (table, table_uuid).';
