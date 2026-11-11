--liquibase formatted sql

-- The Roles & permissions section of Admin settings, as a permission object
-- (packages/shared/src/permissions.ts). The admin role gets it; owner holds everything.

--changeset worktime:036-permission-roles-section
INSERT INTO permissions (id, description) VALUES
    ('section.admin.roles:see:all', 'section.admin.roles — see (all)'),
    ('section.admin.roles:edit:all', 'section.admin.roles — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'section.admin.roles:edit:all'
FROM roles r
WHERE r.name = 'admin' AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
