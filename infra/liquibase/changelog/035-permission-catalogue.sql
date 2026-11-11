--liquibase formatted sql

-- Permission catalogue for navbar entries and UI sections, and default grants for the
-- global (organization_id IS NULL) roles. Mirrors packages/shared/src/permissions.ts:
-- ids are `<object>:<action>:<scope>`; `edit` implies `see`.
-- The defaults reproduce the role checks the app used before, so nothing changes for
-- existing users. `owner` gets no rows: the code grants it everything.
-- The legacy ids (data:read, members:manage, ...) are left in place, unused.

--changeset worktime:035-permission-catalogue
INSERT INTO permissions (id, description)
SELECT o.object || ':' || a.action || ':' || s.scope,
       o.object || ' — ' || a.action || ' (' || s.scope || ')'
FROM (VALUES
        ('nav.time', 'people'), ('nav.timesheet', 'people'), ('nav.workTime', 'people'),
        ('nav.absences', 'people'), ('nav.myData', 'people'), ('nav.expenses', 'people'),
        ('nav.expenseReports', 'people'), ('nav.teamHours', 'people'), ('nav.approvals', 'people'),
        ('nav.users', 'people'),
        ('nav.invitations', 'org'), ('nav.management', 'org'), ('nav.orgSettings', 'org'),
        ('nav.audit', 'org'), ('nav.expenseProcessing', 'org'), ('nav.admin', 'org'),
        ('section.basicdata.personalien', 'people'), ('section.basicdata.address', 'people'),
        ('section.basicdata.civilStatus', 'people')
     ) AS o(object, kind)
CROSS JOIN (VALUES ('see'), ('edit')) AS a(action)
CROSS JOIN (VALUES ('own'), ('team'), ('reports'), ('all')) AS s(scope)
WHERE o.kind = 'people' OR s.scope = 'all'
ON CONFLICT (id) DO NOTHING;

-- Self-service pages and own personal details: every role except owner (which needs no rows).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.permission_id
FROM roles r
CROSS JOIN (VALUES
        ('nav.time:edit:own'), ('nav.timesheet:edit:own'), ('nav.workTime:edit:own'),
        ('nav.absences:edit:own'), ('nav.myData:edit:own'), ('nav.expenses:edit:own'),
        ('nav.expenseReports:edit:own'),
        -- Personalien is changed by HR only; the employee sees it.
        ('section.basicdata.personalien:see:own'),
        ('section.basicdata.address:edit:own'), ('section.basicdata.civilStatus:edit:own')
     ) AS p(permission_id)
WHERE r.organization_id IS NULL AND r.name <> 'owner'
ON CONFLICT DO NOTHING;

-- Role-specific pages and data.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.teamHours:see:all'),
        ('admin', 'nav.approvals:edit:reports'),
        ('admin', 'nav.users:edit:all'),
        ('admin', 'nav.invitations:edit:all'),
        ('admin', 'nav.management:edit:all'),
        ('admin', 'nav.orgSettings:edit:all'),
        ('admin', 'nav.audit:see:all'),
        ('admin', 'nav.expenseProcessing:edit:all'),
        ('admin', 'nav.admin:edit:all'),
        ('admin', 'section.basicdata.personalien:edit:all'),
        ('admin', 'section.basicdata.address:edit:all'),
        ('admin', 'section.basicdata.civilStatus:edit:all'),

        ('manager', 'nav.teamHours:see:all'),
        ('manager', 'nav.approvals:edit:reports'),
        ('manager', 'nav.users:see:all'),
        ('manager', 'nav.invitations:edit:all'),
        ('manager', 'nav.management:edit:all'),

        ('hr', 'nav.users:edit:all'),
        ('hr', 'section.basicdata.personalien:edit:all'),
        ('hr', 'section.basicdata.address:edit:all'),
        ('hr', 'section.basicdata.civilStatus:edit:all'),

        ('billing_admin', 'nav.expenseProcessing:edit:all')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
