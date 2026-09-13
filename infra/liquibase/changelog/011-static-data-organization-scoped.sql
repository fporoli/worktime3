--liquibase formatted sql

-- static_data was a single platform-wide catalog — but different organizations
-- want different pickable values (e.g. their own project types), so it needs
-- to be scoped like every other tenant resource in this schema. Nothing
-- references static_data.id by foreign key, so the existing (demo/seed) rows
-- are cleared rather than guessed-at backfilled into some organization; the
-- seed re-inserts them scoped to the demo org.

--changeset worktime:032-static-data-organization-scoped
DELETE FROM static_data;

ALTER TABLE static_data ADD COLUMN organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS uq_static_data_entity_enum;
DROP INDEX IF EXISTS idx_static_data_entity;

-- One row per (organization, entity, enum_name) — each org can define its own values for the same enum.
CREATE UNIQUE INDEX uq_static_data_org_entity_enum ON static_data(organization_id, entity, enum_name);
CREATE INDEX idx_static_data_org_entity ON static_data(organization_id, entity, enum_name);
