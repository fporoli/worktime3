--liquibase formatted sql

-- Team Management gets an `own` scope: teams the caller leads, projects/subprojects they
-- own (packages/shared/src/permissions.ts). The default manager role moves from editing
-- every team and project to editing its own, while still seeing all of them. That matches
-- what the web page already offered managers; the API used to let them rename or delete
-- any team. Organizations' own copies of manager are left as they configured them.

--changeset worktime:038-permission-management-own
INSERT INTO permissions (id, description) VALUES
    ('nav.management:see:own', 'nav.management — see (own)'),
    ('nav.management:edit:own', 'nav.management — edit (own)')
ON CONFLICT (id) DO NOTHING;

DELETE FROM role_permissions
WHERE permission_id = 'nav.management:edit:all'
  AND role_id IN (SELECT id FROM roles WHERE name = 'manager' AND organization_id IS NULL);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM roles r
CROSS JOIN (VALUES ('nav.management:edit:own'), ('nav.management:see:all')) AS g(permission_id)
WHERE r.name = 'manager' AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
