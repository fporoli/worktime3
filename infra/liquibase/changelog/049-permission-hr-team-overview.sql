--liquibase formatted sql

-- Team overviews (one row per person, per page): a manager always sees their direct reports;
-- HR sees everyone's absences, expenses and expense reports too (read only), as it already does
-- for work time, project time and both timesheets (048). Global default roles only.

--changeset worktime:049-permission-hr-team-overview
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('hr', 'nav.absences:see:all'),
        ('hr', 'nav.expenses:see:all'),
        ('hr', 'nav.expenseReports:see:all')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
