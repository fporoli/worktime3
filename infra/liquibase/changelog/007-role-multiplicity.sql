--liquibase formatted sql

-- role_translations was a 1:many table nothing outside the schema ever
-- queried — folding it into roles.translations (locale -> display_name)
-- removes a join for data that's cheap to load with the role anyway.

--changeset worktime:025-fold-role-translations
ALTER TABLE roles ADD COLUMN translations JSONB NOT NULL DEFAULT '{}';

UPDATE roles r
SET translations = agg.translations
FROM (
    SELECT role_id, jsonb_object_agg(locale, display_name) AS translations
    FROM role_translations
    GROUP BY role_id
) agg
WHERE agg.role_id = r.id;

DROP TABLE role_translations;

-- Users allowed to grant/revoke this specific role for others, in addition
-- to org owners/admins (who can always manage any role). Not FK-enforced —
-- same plain-array trade-off already made for organizations.ip_allowlist
-- and organizations.allowed_email_domains.

--changeset worktime:026-role-admin-users
ALTER TABLE roles ADD COLUMN admin_user_ids UUID[] NOT NULL DEFAULT '{}';

-- A membership used to carry exactly one role_id. Decoupled into a proper
-- many-to-many so a person can hold multiple roles in the same
-- organization at once (e.g. "manager" + a custom "billing-admin" role).
-- Existing single-role assignments are carried over as the first row.

--changeset worktime:027-decouple-membership-roles
CREATE TABLE membership_roles (
    membership_id      UUID NOT NULL REFERENCES organization_memberships(id) ON DELETE CASCADE,
    role_id             UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (membership_id, role_id)
);
CREATE INDEX idx_membership_roles_role ON membership_roles(role_id);

INSERT INTO membership_roles (membership_id, role_id)
SELECT id, role_id FROM organization_memberships;

ALTER TABLE organization_memberships DROP COLUMN role_id;

COMMENT ON TABLE membership_roles IS 'Many-to-many: one organization membership can hold several roles at once.';
