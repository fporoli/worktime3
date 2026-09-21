--liquibase formatted sql

-- membership_roles was a plain many-to-many with no payload anyone reads
-- besides the role id — folding it into organization_memberships.role_ids
-- removes a join from every permission check. Not FK-enforced — same
-- plain-array trade-off already made for roles.admin_user_ids and
-- organizations.ip_allowlist. granted_at/granted_by_user_id are dropped
-- with the table (the audit log still records role.grant / role.revoke).

--changeset worktime:062-fold-membership-roles
ALTER TABLE organization_memberships ADD COLUMN role_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE organization_memberships m
SET role_ids = agg.role_ids
FROM (
    SELECT membership_id, array_agg(role_id ORDER BY granted_at, role_id) AS role_ids
    FROM membership_roles
    GROUP BY membership_id
) agg
WHERE agg.membership_id = m.id;

DROP TABLE membership_roles;

CREATE INDEX idx_memberships_role_ids ON organization_memberships USING GIN (role_ids);

COMMENT ON COLUMN organization_memberships.role_ids IS 'Roles held by this membership (roles.id values, not FK-enforced). Permissions are additive across them.';
