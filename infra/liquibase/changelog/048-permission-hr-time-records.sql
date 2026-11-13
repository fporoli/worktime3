--liquibase formatted sql

-- Who changes what (global default roles; an org's own role copies are left as the org set them):
-- - The work schedule (Arbeitszeitmodell) is HR's alone: admin keeps seeing it, no longer edits it.
-- - Personalien joins address and civil status: the employee may request a change, HR approves.
--   (`:edit:own` on a basic-data section means "request"; HR's `:edit:all` edits and approves.)
-- - Work time, project time and both monthly timesheets: besides the person and their designated
--   manager (always, by the reporting line), HR edits everyone's records and reopens their months.
--   Records stay locked while a month is submitted or approved; it has to be reopened first.

--changeset worktime:048-permission-hr-time-records
DELETE FROM role_permissions
WHERE permission_id LIKE 'section.workTime.schedule:edit:%'
  AND role_id IN (SELECT id FROM roles WHERE name = 'admin' AND organization_id IS NULL);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'section.workTime.schedule:see:all'),
        ('hr', 'nav.workTime:edit:all'),
        ('hr', 'nav.time:edit:all'),
        ('hr', 'nav.timesheet:edit:all'),
        ('hr', 'nav.projectTimesheet:edit:all')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;

-- Every role except owner (which needs no rows) may request a change of its own Personalien.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'section.basicdata.personalien:edit:own'
FROM roles r
WHERE r.organization_id IS NULL AND r.name <> 'owner'
ON CONFLICT DO NOTHING;
