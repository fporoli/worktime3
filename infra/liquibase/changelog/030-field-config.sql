--liquibase formatted sql

-- Configurable form fields (docs/FIELD_CONFIG.md). The code registry in
-- packages/shared/src/fields.ts holds the defaults; each row here overrides some
-- properties of one field for every organization (organization_id IS NULL, the
-- global template) or for one organization. Group titles and order live in a row
-- with field_key '$groups'.

--changeset worktime:063-field-config
CREATE TABLE field_config (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
    form_id          VARCHAR(64) NOT NULL,
    field_key        VARCHAR(64) NOT NULL,
    is_custom        BOOLEAN     NOT NULL DEFAULT FALSE,
    config           JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX uq_field_config ON field_config
    (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), form_id, field_key);

--changeset worktime:064-superdeveloper
-- Edits the global template. Not an org role: only another superdeveloper or the database sets it.
ALTER TABLE users ADD COLUMN is_superdeveloper BOOLEAN NOT NULL DEFAULT FALSE;

--changeset worktime:065-developer-role
INSERT INTO roles (id, organization_id, name, description, is_system_role) VALUES
    ('00000000-0000-0000-0000-000000000008', NULL, 'developer',
     'Can change the organization''s form layout, captions and translations', TRUE);
