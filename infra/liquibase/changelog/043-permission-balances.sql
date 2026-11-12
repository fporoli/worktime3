--liquibase formatted sql

-- "Time balances" page (packages/shared/src/permissions.ts, nav.balances): the monthly report of
-- overtime and vacation balances with alerts, and booking adjustments and vacation entitlements.
-- Everyone sees their own balances on the Work time page regardless; this grants others'.
-- Managers see their reports', admin and hr everyone's and may edit (global roles and organizations'
-- own copies of them, which have never seen this page). Owner holds everything.

--changeset worktime:043-permission-balances
INSERT INTO permissions (id, description) VALUES
    ('nav.balances:see:own', 'nav.balances — see (own)'),
    ('nav.balances:see:team', 'nav.balances — see (team)'),
    ('nav.balances:see:reports', 'nav.balances — see (reports)'),
    ('nav.balances:see:all', 'nav.balances — see (all)'),
    ('nav.balances:edit:own', 'nav.balances — edit (own)'),
    ('nav.balances:edit:team', 'nav.balances — edit (team)'),
    ('nav.balances:edit:reports', 'nav.balances — edit (reports)'),
    ('nav.balances:edit:all', 'nav.balances — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.balances:edit:all'),
        ('hr', 'nav.balances:edit:all'),
        ('manager', 'nav.balances:see:reports')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name
ON CONFLICT DO NOTHING;
