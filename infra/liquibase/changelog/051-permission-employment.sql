--liquibase formatted sql

-- "Employment" section (packages/shared/src/permissions.ts, section.people.employment): start date and
-- the dated department / function / manager assignments, on My data (own) and the Users page.
-- Everyone sees their own, managers their reports', admin everyone's; HR and admin maintain it
-- (admin used to set the manager line on the Users page). Owner holds everything.

--changeset worktime:051-permission-employment
INSERT INTO permissions (id, description) VALUES
    ('section.people.employment:see:own', 'section.people.employment — see (own)'),
    ('section.people.employment:see:team', 'section.people.employment — see (team)'),
    ('section.people.employment:see:reports', 'section.people.employment — see (reports)'),
    ('section.people.employment:see:all', 'section.people.employment — see (all)'),
    ('section.people.employment:edit:own', 'section.people.employment — edit (own)'),
    ('section.people.employment:edit:team', 'section.people.employment — edit (team)'),
    ('section.people.employment:edit:reports', 'section.people.employment — edit (reports)'),
    ('section.people.employment:edit:all', 'section.people.employment — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM roles r
JOIN (VALUES
        ('admin', 'section.people.employment:edit:all'),
        ('hr', 'section.people.employment:edit:all'),
        ('manager', 'section.people.employment:see:reports'),
        ('member', 'section.people.employment:see:own'),
        ('guest', 'section.people.employment:see:own'),
        ('billing_admin', 'section.people.employment:see:own'),
        ('developer', 'section.people.employment:see:own')
     ) AS g(role_name, permission_id) ON g.role_name = r.name
ON CONFLICT DO NOTHING;
