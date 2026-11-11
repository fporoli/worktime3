--liquibase formatted sql

-- Data access the API used to grant by role name, now as permissions
-- (packages/shared/src/permissions.ts). Reproduces the previous behavior:
-- - admin saw and overrode everyone's project time, work time, timesheets, absences,
--   balances, expenses and expense reports, and resolved any approval;
-- - hr opened the Users page (for personal details) but did not administer members:
--   Users `edit` now means member administration, so hr gets `see`.
-- A person's designated manager still sees their data through the reporting line,
-- independent of roles. Applied to org copies of admin too, as these were hard-wired before.

--changeset worktime:037-permission-data-grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('nav.time:see:all'),
        ('nav.workTime:see:all'),
        ('nav.timesheet:edit:all'),
        ('nav.absences:edit:all'),
        ('nav.expenses:see:all'),
        ('nav.expenseReports:see:all'),
        ('nav.approvals:edit:all')
     ) AS g(permission_id)
JOIN roles r ON r.name = 'admin'
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions
WHERE permission_id = 'nav.users:edit:all'
  AND role_id IN (SELECT id FROM roles WHERE name = 'hr' AND organization_id IS NULL);

INSERT INTO role_permissions (role_id, permission_id)
SELECT id, 'nav.users:see:all' FROM roles WHERE name = 'hr' AND organization_id IS NULL
ON CONFLICT DO NOTHING;
