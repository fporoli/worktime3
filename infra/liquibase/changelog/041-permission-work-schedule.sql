--liquibase formatted sql

-- Work schedules as a permission section (packages/shared/src/permissions.ts): shown in
-- My data for one's own schedule and from the Users page for others'. Everyone sees their own,
-- managers their reports', admin and hr edit everyone's. Owner holds everything.

--changeset worktime:041-permission-work-schedule
INSERT INTO permissions (id, description) VALUES
    ('section.workTime.schedule:see:own', 'section.workTime.schedule — see (own)'),
    ('section.workTime.schedule:see:team', 'section.workTime.schedule — see (team)'),
    ('section.workTime.schedule:see:reports', 'section.workTime.schedule — see (reports)'),
    ('section.workTime.schedule:see:all', 'section.workTime.schedule — see (all)'),
    ('section.workTime.schedule:edit:own', 'section.workTime.schedule — edit (own)'),
    ('section.workTime.schedule:edit:team', 'section.workTime.schedule — edit (team)'),
    ('section.workTime.schedule:edit:reports', 'section.workTime.schedule — edit (reports)'),
    ('section.workTime.schedule:edit:all', 'section.workTime.schedule — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'section.workTime.schedule:see:own'
FROM roles r
WHERE r.organization_id IS NULL AND r.name <> 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'section.workTime.schedule:edit:all'),
        ('hr', 'section.workTime.schedule:edit:all'),
        ('manager', 'section.workTime.schedule:see:reports')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
