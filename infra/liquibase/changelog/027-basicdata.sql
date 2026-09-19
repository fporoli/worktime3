--liquibase formatted sql

-- "Meine Daten" portal: personal + family data, stored as a single JSON blob per user rather than
-- a fixed set of columns (fields like nationality, bank accounts, or children don't warrant their
-- own tables). An org admin/HR edit applies immediately; anyone else can only submit a change
-- request, which sits in basicdata_versions with status 'changerequested' until an admin/HR
-- approves or rejects it — see BasicDataService.

--changeset worktime:057-users-basicdata
ALTER TABLE users ADD COLUMN basicdata JSONB NOT NULL DEFAULT '{}';

--changeset worktime:058-basicdata-versions
CREATE TABLE basicdata_versions (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    version_nr               INTEGER NOT NULL DEFAULT 0,
    created                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lastmodified             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lastmodified_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Array of {version, status, data, requested_by_user_id, requested_at, reviewed_by_user_id,
    -- reviewed_at, note}. status is one of: approved / changerequested / rejected.
    history                  JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT chk_basicdata_versions_version_nr_non_negative CHECK (version_nr >= 0)
);

--changeset worktime:059-seed-hr-role
-- A system role (like billing_admin) rather than a per-org one — see access.ts isOrgHrOrAdmin.
INSERT INTO roles (id, organization_id, name, description, is_system_role) VALUES
    ('00000000-0000-0000-0000-000000000007', NULL, 'hr', 'Can review and correct employees basic/personal data', TRUE);
