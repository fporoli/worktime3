--liquibase formatted sql

-- "Project timesheet" page (packages/shared/src/permissions.ts, nav.projectTimesheet): everyone
-- submits their own; admin sees everyone's. Approving is done by the project's owner from the
-- Approvals page, independent of this permission. Granted to global roles and organizations'
-- own copies of them, which have never seen this page. Owner holds everything.

--changeset worktime:045-permission-project-timesheet
INSERT INTO permissions (id, description) VALUES
    ('nav.projectTimesheet:see:own', 'nav.projectTimesheet — see (own)'),
    ('nav.projectTimesheet:see:team', 'nav.projectTimesheet — see (team)'),
    ('nav.projectTimesheet:see:reports', 'nav.projectTimesheet — see (reports)'),
    ('nav.projectTimesheet:see:all', 'nav.projectTimesheet — see (all)'),
    ('nav.projectTimesheet:edit:own', 'nav.projectTimesheet — edit (own)'),
    ('nav.projectTimesheet:edit:team', 'nav.projectTimesheet — edit (team)'),
    ('nav.projectTimesheet:edit:reports', 'nav.projectTimesheet — edit (reports)'),
    ('nav.projectTimesheet:edit:all', 'nav.projectTimesheet — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.projectTimesheet:edit:own'
FROM roles r
WHERE r.name <> 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.projectTimesheet:see:all'
FROM roles r
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;
