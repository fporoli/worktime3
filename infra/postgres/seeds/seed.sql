-- seed.sql — demo users, org, roles, project + project times + static data.
-- Runs on a migrated database (Liquibase changelogs).
--
-- Additive and re-runnable: every row has a fixed key and `ON CONFLICT DO NOTHING`, and the
-- UPDATEs only fill in values that are still unset. Running it again adds what is missing and
-- leaves changed demo data (passwords, reporting lines, translations) alone. The VPS `seed`
-- action relies on this; `reset-seed` drops the schema first for a clean state.


INSERT INTO users (id, email, display_name, first_name, last_name, locale, timezone, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@acme.com', 'Acme Glox Admin', 'Adam',   'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'alice@acme.com', 'Alice A',         'Alice',  'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222223', 'adam@acme.com',  'Adam A' ,         'Adam',   'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222224', 'marta@acme.com', 'Marta A',         'Marta',  'Manager', 'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222225', 'marco@acme.com', 'Marco A',         'Marco',  'Manager', 'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222226', 'ulla@acme.com',  'Ulla A' ,         'Ulla',   'User',    'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222227', 'ueli@acme.com',  'Ueli A' ,         'Ueli',   'User',    'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222228', 'uma@acme.com',   'Uma A'  ,         'Uma'  ,  'User',    'en', 'Europe/Zurich', 'active')
ON CONFLICT (email) DO NOTHING;

INSERT INTO organizations (id, slug, name, type, country, created_by_user_id, is_active)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'acme', 'Acme Corp', 'enterprise', 'CH', '11111111-1111-1111-1111-111111111111', TRUE),
  -- Second org so the web app's organization switcher has something to switch between in the demo.
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'globx', 'Globx Inc', 'team', 'US', '11111111-1111-1111-1111-111111111111', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Look and feel (organizations.settings.branding, edited in Organization settings). Logos are
-- base64 copies of infra/postgres/seeds/branding/*.svg (test/api/branding.test.ts checks they
-- match). Only set while an organization has no branding, so re-seeding keeps an admin's choice.
-- Globx has a dark sidebar, to show that the sidebar text switches to light.
UPDATE organizations o
SET settings = o.settings || jsonb_build_object('branding', v.branding::jsonb)
FROM (VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"headerColor":"#0f766e","backgroundColor":"#f2f7f6","sidebarColor":"#ecfdf9","logo":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzJkZDRiZiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwZjc2NmUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHg9IjEiIHk9IjEiIHdpZHRoPSI2MiIgaGVpZ2h0PSI2MiIgcng9IjE0IiBmaWxsPSJ1cmwoI2JnKSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC40NSIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPHBhdGggZmlsbD0iI2ZmZmZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMjcgMTFoMTBsMTUgNDFINDJsLTMtOUgyNWwtMyA5SDEyem01IDEzLTQuNyAxM2g5LjR6Ii8+CiAgPHBhdGggZmlsbD0iI2ZiYmYyNCIgZD0iTTUwIDhsMS45IDQuNkw1Ni41IDE0bC00LjYgMS45TDUwIDIwLjVsLTEuOS00LjZMNDMuNSAxNGw0LjYtMS40eiIvPgo8L3N2Zz4K"}'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '{"headerColor":"#5b21b6","backgroundColor":"#f6f5fb","sidebarColor":"#2e1065","logo":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2E3OGJmYSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM0YzFkOTUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHg9IjEiIHk9IjEiIHdpZHRoPSI2MiIgaGVpZ2h0PSI2MiIgcng9IjE0IiBmaWxsPSJ1cmwoI2JnKSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC40NSIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPGcgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2UtbGluZWNhcD0icm91bmQiPgogICAgPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMTUiIHN0cm9rZS13aWR0aD0iMyIvPgogICAgPGVsbGlwc2UgY3g9IjMyIiBjeT0iMzIiIHJ4PSI2LjUiIHJ5PSIxNSIgc3Ryb2tlLXdpZHRoPSIyLjQiLz4KICAgIDxwYXRoIGQ9Ik0xNy41IDI3aDI5TTE3LjUgMzdoMjkiIHN0cm9rZS13aWR0aD0iMi40Ii8+CiAgPC9nPgogIDxlbGxpcHNlIGN4PSIzMiIgY3k9IjMyIiByeD0iMjYiIHJ5PSI4IiBmaWxsPSJub25lIiBzdHJva2U9IiNmYmJmMjQiIHN0cm9rZS13aWR0aD0iMy4yIiB0cmFuc2Zvcm09InJvdGF0ZSgtMjggMzIgMzIpIi8+CiAgPGNpcmNsZSBjeD0iNTQuNSIgY3k9IjIwIiByPSIzLjIiIGZpbGw9IiNmYmJmMjQiLz4KPC9zdmc+Cg=="}')
) AS v(id, branding)
WHERE o.id = v.id::uuid AND NOT (o.settings ? 'branding');

-- Public holidays follow a canton (organizations.settings.holidayRegion, Organization settings ->
-- Working time and holidays). Only set while an organization has none.
UPDATE organizations o
SET settings = o.settings || jsonb_build_object('holidayRegion', v.region)
FROM (VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ZH'), ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'GE')) AS v(id, region)
WHERE o.id = v.id::uuid AND NOT jsonb_exists(o.settings, 'holidayRegion');

INSERT INTO roles(id, organization_id, "name", description, is_system_role, settings, translations, admin_user_ids) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, NULL, 'owner', 'Full organization owner and legal contact', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000002'::uuid, NULL, 'admin', 'Organization administrator', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000003'::uuid, NULL, 'member', 'Standard collaborator with read/write access', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000004'::uuid, NULL, 'guest', 'Restricted access to tbd', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000005'::uuid, NULL, 'billing_admin', 'Can manage billing and subscription tiers only', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000006'::uuid, NULL, 'manager', 'Manager with team, project, and subproject access', true, '{}'::jsonb, '{}'::jsonb, '{}')
ON CONFLICT DO NOTHING;

-- Memberships: admin->admin role, manager->manager role, user->member role
INSERT INTO organization_memberships (id, organization_id, user_id, status, joined_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', to_date('2023-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'active', to_date('2023-02-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222223', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222223', 'active', to_date('2021-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222224', 'active', to_date('2020-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333334', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222225', 'active', to_date('2022-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333335', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222226', 'active', to_date('2023-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333336', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222227', 'active', to_date('2024-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222228', 'active', to_date('2025-01-01', 'YYYY-MM-DD')),

  -- admin is also admin of Globex; manager is only a plain member there — same person, different role per org.
  ('eeeeeeee-eeee-eeee-eeee-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'active', to_date('2023-01-01', 'YYYY-MM-DD')),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'active', to_date('2023-01-01', 'YYYY-MM-DD'))
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Employment start: the seeded joined_at date (only where none is set yet).
UPDATE organization_memberships SET start_date = joined_at::date
WHERE organization_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
  AND start_date IS NULL AND joined_at IS NOT NULL;

-- Acme departments, each with a default leader (only a default: the manager is set per person).
INSERT INTO departments (id, organization_id, name, leader_user_id, sort_order) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Administration', '22222222-2222-2222-2222-222222222222', 1),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'HR', '22222222-2222-2222-2222-222222222226', 2),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sales', '22222222-2222-2222-2222-222222222224', 3),
  ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Marketing', NULL, 4),
  ('dddddddd-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Research & Development', '22222222-2222-2222-2222-222222222223', 5)
ON CONFLICT DO NOTHING;

-- Acme reporting lines, dated (employee_assignments; approvals route to the manager in force):
--   Alice  -> Admin, Adam
--   Adam   -> Marta, Marco, Uma
--   Marta  -> Ulla, and Ueli until mid-2025 (Sales), when he moved to R&D under Marco
--   Marco  -> Ueli
-- valid_from is each person's start date, so rows the 050 migration made from an old manager
-- column are the same rows (the natural key is the row's key): only their unset department and
-- function get filled in.
INSERT INTO employee_assignments (organization_id, user_id, valid_from, department_id, job_function, manager_user_id)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', v.user_id::uuid,
       COALESCE(v.valid_from::date, m.start_date, m.joined_at::date), v.department_id::uuid, v.job_function, v.manager_user_id::uuid
FROM (VALUES
  ('22222222-2222-2222-2222-222222222222', NULL, 'dddddddd-0000-0000-0000-000000000001', 'Managing Director', NULL),                                    -- Alice
  ('11111111-1111-1111-1111-111111111111', NULL, 'dddddddd-0000-0000-0000-000000000001', 'System Administrator', '22222222-2222-2222-2222-222222222222'), -- Admin <- Alice
  ('22222222-2222-2222-2222-222222222223', NULL, 'dddddddd-0000-0000-0000-000000000005', 'Head of R&D', '22222222-2222-2222-2222-222222222222'),          -- Adam  <- Alice
  ('22222222-2222-2222-2222-222222222224', NULL, 'dddddddd-0000-0000-0000-000000000003', 'Head of Sales', '22222222-2222-2222-2222-222222222223'),        -- Marta <- Adam
  ('22222222-2222-2222-2222-222222222225', NULL, 'dddddddd-0000-0000-0000-000000000005', 'Team Lead', '22222222-2222-2222-2222-222222222223'),            -- Marco <- Adam
  ('22222222-2222-2222-2222-222222222228', NULL, 'dddddddd-0000-0000-0000-000000000005', 'Software Developer', '22222222-2222-2222-2222-222222222223'),   -- Uma   <- Adam
  ('22222222-2222-2222-2222-222222222226', NULL, 'dddddddd-0000-0000-0000-000000000002', 'HR Specialist', '22222222-2222-2222-2222-222222222224'),        -- Ulla  <- Marta
  ('22222222-2222-2222-2222-222222222227', NULL, 'dddddddd-0000-0000-0000-000000000003', 'Sales Assistant', '22222222-2222-2222-2222-222222222224'),      -- Ueli  <- Marta (Sales)
  ('22222222-2222-2222-2222-222222222227', '2025-07-01', 'dddddddd-0000-0000-0000-000000000005', 'Software Developer', '22222222-2222-2222-2222-222222222225') -- Ueli  <- Marco (R&D)
) AS v(user_id, valid_from, department_id, job_function, manager_user_id)
JOIN organization_memberships m ON m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND m.user_id = v.user_id::uuid
ON CONFLICT (organization_id, user_id, valid_from) DO UPDATE
SET department_id = COALESCE(employee_assignments.department_id, EXCLUDED.department_id),
    job_function = COALESCE(employee_assignments.job_function, EXCLUDED.job_function);

-- Roles per membership (a membership can hold more than one). Everyone who manages someone
-- above holds the manager role; Ulla is also hr, Uma also developer.
INSERT INTO membership_roles (membership_id, role_id)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', '00000000-0000-0000-0000-000000000002'), -- Admin: admin
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', '00000000-0000-0000-0000-000000000006'), -- Alice: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222223', '00000000-0000-0000-0000-000000000006'), -- Adam: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333333', '00000000-0000-0000-0000-000000000006'), -- Marta: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333334', '00000000-0000-0000-0000-000000000006'), -- Marco: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333335', '00000000-0000-0000-0000-000000000003'), -- Ulla: member
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333335', '00000000-0000-0000-0000-000000000007'), -- Ulla: hr
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333336', '00000000-0000-0000-0000-000000000003'), -- Ueli: member
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444444', '00000000-0000-0000-0000-000000000003'), -- Uma: member
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444444', '00000000-0000-0000-0000-000000000008'), -- Uma: developer
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '00000000-0000-0000-0000-000000000002'),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', '00000000-0000-0000-0000-000000000003')
ON CONFLICT (membership_id, role_id) DO NOTHING;

-- Demo form designer: admin@acme.com edits Acme's form template (developer) and the global one (superdeveloper).
INSERT INTO membership_roles (membership_id, role_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', '00000000-0000-0000-0000-000000000008')
ON CONFLICT (membership_id, role_id) DO NOTHING;
-- Re-grants the flag if it was revoked on the demo admin (a boolean has no "unset" to check).
UPDATE users SET is_superdeveloper = TRUE WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO teams (id, organization_id, name, description, lead_user_id)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Platform', 'Platform team', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO team_members (team_id, membership_id)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-333333333333')
ON CONFLICT (team_id, membership_id) DO NOTHING;

INSERT INTO projects (id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Website FIFA Relaunch', '22222222-2222-2222-2222-222222222222', 'COST-100', 'customer'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Microsoft 365 Intro @ UBS', '22222222-2222-2222-2222-222222222222', 'COST-101', 'customer'),
       ('cccccccc-cccc-cccc-cccc-ccccccccccce', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme Internal Project', '22222222-2222-2222-2222-222222222222', 'COST-102', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subprojects (id, project_id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Design phase', '22222222-2222-2222-2222-222222222222', 'COST-101', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Implementation phase', '22222222-2222-2222-2222-222222222222', 'COST-101', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'cccccccc-cccc-cccc-cccc-cccccccccccd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '365 Status Assessment', '22222222-2222-2222-2222-222222222222', 'COST-102', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd3', 'cccccccc-cccc-cccc-cccc-ccccccccccce', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Novatime Migration', '22222222-2222-2222-2222-222222222222', 'COST-103', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd4', 'cccccccc-cccc-cccc-cccc-ccccccccccce', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Novatime Replacement', '22222222-2222-2222-2222-222222222222', 'COST-104', 'phase')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_times (id, user_id, organization_id, project_id, subproject_id, start_time, end_time, comment)
VALUES
  ('99999999-9999-9999-9999-111111111111', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours', 'Homepage hero'),
  ('99999999-9999-9999-9999-222222222222', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '90 minutes', 'Bugfix')
ON CONFLICT DO NOTHING;

INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'projects', 'project_type', '{"internal":"Internal","customer":"Customer","research":"Research"}', '{"de":{"internal":"Intern"}}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'organization_memberships', 'membership_status', '{"active":"Active","invited":"Invited","suspended":"Suspended"}', '{}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project_times', 'billability', '{"billable":"Billable","non_billable":"Non billable"}', '{}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'expenses', 'expense_category', '{"travel":"Travel","meals":"Meals & Entertainment","supplies":"Office Supplies","software":"Software & Subscriptions","other":"Other"}', '{}'),
  -- Sub-category keys are prefixed "<parent category key>$<sub-category key>" so the UI can filter
  -- this one enum down to just the options under whichever category is currently selected, without
  -- a separate static_data row (or table) per parent category.
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'expenses', 'expense_subcategory', '{"travel$flight":"Flight","travel$hotel":"Hotel","travel$taxi":"Taxi/Rideshare","meals$client_lunch":"Client Lunch","meals$team_lunch":"Team Lunch"}', '{}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'expenses', 'billing_type', '{"billable":"Billable to client","non_billable":"Non-billable","internal":"Internal / overhead"}', '{}')
ON CONFLICT DO NOTHING;

-- Global (organization_id = NULL) countries, for nationality and address. Migrations already insert
-- them (and `locales`), so on a migrated database this row is a no-op.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES
  (NULL, 'users', 'countries', '{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}'::jsonb, '{"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}'::jsonb)
ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), entity, enum_name) DO NOTHING;

-- Existing keys win (`default || current`), so a translation edited since is kept.
UPDATE roles SET translations = '{"de":"Administrator"}'::jsonb || translations WHERE id = '00000000-0000-0000-0000-000000000002';
UPDATE roles SET translations = '{"de":"Manager"}'::jsonb || translations WHERE id = '00000000-0000-0000-0000-000000000006';
UPDATE roles SET translations = '{"de":"Benutzer"}'::jsonb || translations WHERE id = '00000000-0000-0000-0000-000000000003';


-- Local password identities for the demo users: the password is the email's local part
-- (admin@acme.com / admin, adam@acme.com / adam, ...). Lets the web login screen sign in
-- without Keycloak. A password someone changed since is kept (reset-seed restores them all).
INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'password', 'admin@acme.com', '$2a$10$gcYrx7XI8py9JpaAsobCFOmJ/o0OmzqFES7pwVIi11v/PUIPoktda'),
  ('22222222-2222-2222-2222-222222222222', 'password', 'alice@acme.com', '$2a$10$sDt5nGnyeuRLaPxScZLTOu5Ymo5bEi5bjXcICFLrxugvZQlGiA41C'),
  ('22222222-2222-2222-2222-222222222223', 'password', 'adam@acme.com',  '$2a$10$lMAjV/YzxNt39F5nvuD70OrVgQN7wnmj1D4uBTjb8gC5JHMWAtxAu'),
  ('22222222-2222-2222-2222-222222222224', 'password', 'marta@acme.com', '$2a$10$5eHdX767Cv5FlZRrxcfoW.e0ev4Hrv5/bt9h3oizMn0Xar22Zs7cm'),
  ('22222222-2222-2222-2222-222222222225', 'password', 'marco@acme.com', '$2a$10$PaOV5WVXSdHULNumYa/5Aulw.M542lTPczfZxSPPFRJl3dSAawTPC'),
  ('22222222-2222-2222-2222-222222222226', 'password', 'ulla@acme.com',  '$2a$10$2PPuwC7fbSihPj1JprqLteAABeVc4JbtI7FsugBNEdmoLbGYC5Him'),
  ('22222222-2222-2222-2222-222222222227', 'password', 'ueli@acme.com',  '$2a$10$JJiF5sk1UDoMJ.V4rRWDzOil.oagGttPZh9WKuSob4QsedJ7xWnyq'),
  ('22222222-2222-2222-2222-222222222228', 'password', 'uma@acme.com',   '$2a$10$O3mA43NN4tORWX04scyVVuXR.eH1SF3KkUac5oyyBNHtUsPL537wO')
ON CONFLICT (provider, provider_user_id) DO NOTHING;
-- In case you need to force.... DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Demo-account dropdown on the login screen (GET /auth/demo-accounts, public). Global row.
-- Key = dropdown order; value = a JSON string {name, user, password}, kept a string so the
-- Admin Settings static-data editor (flat key -> text) can still show and edit it.
-- Only seeded databases have this row, so production login screens show no dropdown. The other
-- demo users still sign in by typing their email and password.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES (NULL, 'login', 'demo_accounts', '{
  "01": "{\"name\":\"Admin (Acme)\",\"user\":\"admin@acme.com\",\"password\":\"admin\"}",
  "02": "{\"name\":\"Manager (Acme)\",\"user\":\"marta@acme.com\",\"password\":\"marta\"}",
  "03": "{\"name\":\"HR User (Acme)\",\"user\":\"ulla@acme.com\",\"password\":\"ulla\"}",
  "04": "{\"name\":\"User (Acme)\",\"user\":\"ueli@acme.com\",\"password\":\"ueli\"}"
}'::jsonb, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- Pending invitation for the login screen's "invited user" demo (token: dev-invite-0001).
INSERT INTO organization_invitations (organization_id, email, role_id, token, invited_by_user_id, status, expires_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'invited@acme.com', '00000000-0000-0000-0000-000000000003', 'dev-invite-0001', '11111111-1111-1111-1111-111111111111', 'pending', '2030-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

-- Demo expenses for the `user` demo account. The third one is left unmapped to any
-- report, to exercise the "nothing attached yet" empty state in the report builder.
INSERT INTO expenses (id, user_id, organization_id, project_id, subproject_id, expense_date, category, sub_category, billing_type, original_value, original_currency, currency, quantity, comment)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, (NOW() - INTERVAL '5 days')::date, 'travel', 'taxi', 'billable', 45.00, 'EUR', 'CHF', NULL, 'Taxi to client site'),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, (NOW() - INTERVAL '5 days')::date, 'meals', 'client_lunch', 'billable', 60.00, 'EUR', 'CHF', NULL, 'Lunch with client'),
  ('eeeeeeee-eeee-eeee-eeee-333333333333', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, NULL, (NOW() - INTERVAL '1 day')::date, 'supplies', NULL, 'non_billable', 25.50, 'CHF', 'CHF', 1, 'USB-C cable')
ON CONFLICT (id) DO NOTHING;

-- Demo report bundling the first two expenses above, already submitted for manager approval.
INSERT INTO expense_reports (id, organization_id, user_id, status, date_submitted, data)
VALUES ('ffffffff-ffff-ffff-ffff-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222226', 'submitted', NOW() - INTERVAL '4 days', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_report_items (expense_report_id, expense_id, organization_id)
VALUES
  ('ffffffff-ffff-ffff-ffff-111111111111', 'eeeeeeee-eeee-eeee-eeee-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('ffffffff-ffff-ffff-ffff-111111111111', 'eeeeeeee-eeee-eeee-eeee-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (expense_id) DO NOTHING;

-- Demo history for every active Acme member, from their employment start date until yesterday
-- (Europe/Zurich): absences, attendance, project time, both monthly timesheets, expenses and
-- expense reports.
--
--   * Absences (past only, approved): 20-30 vacation days a year (prorated in the first year),
--     as a two-week summer holiday, a one-week break and single or short days, sometimes a half
--     day; plus a few sick days. The year's plan does not depend on today, so a later re-seed
--     only adds the blocks that have since passed. Untaken or extra days carry over (the
--     balances compute that).
--   * Attendance (work_times) on every working day without a full-day absence: 1 session on 15%
--     of the days, 2 on 60%, 3 on 20%, 4 on 5%; 7-9 hours a day around the 8-hour target, about
--     half on half-day absences.
--     Working days skip weekends and Zurich's public holidays (Acme's holidayRegion).
--   * Project time: 1-2 entries a day on a project (and subproject), 80-100% of that day's
--     attendance, never more.
--   * Timesheets: every month before the current one is submitted and approved, the working-time
--     one by the manager in force (the API closes it into work_time_months when balances are
--     read), the project one by the project's owner. The current month stays open.
--   * Expenses: 0-3 a month, in one expense report a month: finished, approved for the last two
--     months, in preparation for the current one.
--
-- Pseudo-random but deterministic: values come from md5 of a key (person, day, purpose), and ids
-- are md5-derived too, so a re-run inserts nothing twice. A day on which the person already has
-- attendance or project time (real data, older demo data) is left alone, and so is an absence
-- that would overlap another one or recorded attendance.

CREATE FUNCTION pg_temp.seed_rnd(key text) RETURNS double precision LANGUAGE sql IMMUTABLE AS
$$ SELECT ('x' || substr(md5(key), 1, 8))::bit(32)::bigint / 4294967296.0 $$;

CREATE FUNCTION pg_temp.seed_id(key text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT md5('worktime3-demo-history:' || key)::uuid $$;

-- Easter Sunday (anonymous Gregorian algorithm, as packages/shared/src/worktime.ts).
CREATE FUNCTION pg_temp.seed_easter(y int) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
BEGIN
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25;
  g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  RETURN make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
END $$;

-- A working day clock Acme: Monday-Friday and not a Zurich public holiday.
CREATE FUNCTION pg_temp.seed_workday(day date) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e date := pg_temp.seed_easter(extract(year FROM day)::int); md text := to_char(day, 'MM-DD');
BEGIN
  RETURN extract(isodow FROM day) < 6
    AND md NOT IN ('01-01', '01-02', '05-01', '08-01', '12-25', '12-26')
    AND day NOT IN (e - 2, e + 1, e + 39, e + 50);
END $$;

-- The manager in force for a person on a date (employee_assignments), else their first one.
CREATE FUNCTION pg_temp.seed_manager(org uuid, person uuid, day date) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT manager_user_id FROM employee_assignments
  WHERE organization_id = org AND user_id = person
  ORDER BY (valid_from <= day) DESC, CASE WHEN valid_from <= day THEN valid_from END DESC NULLS LAST, valid_from
  LIMIT 1
$$;

-- The last of `n` working days starting clock the first working day on or after `day`.
CREATE FUNCTION pg_temp.seed_span_end(day date, n int) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date := day; counted int := 0;
BEGIN
  LOOP
    IF pg_temp.seed_workday(d) THEN
      counted := counted + 1;
      EXIT WHEN counted >= n;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN d;
END $$;

CREATE FUNCTION pg_temp.seed_next_workday(day date) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date := day;
BEGIN
  WHILE NOT pg_temp.seed_workday(d) LOOP d := d + 1; END LOOP;
  RETURN d;
END $$;

DO $$
DECLARE
  org constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  tz constant text := 'Europe/Zurich';
  today constant date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  -- Projects and their subprojects (seeded above); comments per project.
  projects constant uuid[] := ARRAY['cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccd', 'cccccccc-cccc-cccc-cccc-ccccccccccce']::uuid[];
  subprojects constant text[] := ARRAY[
    'dddddddd-dddd-dddd-dddd-dddddddddddd,dddddddd-dddd-dddd-dddd-ddddddddddd1',
    'dddddddd-dddd-dddd-dddd-ddddddddddd2,',
    'dddddddd-dddd-dddd-dddd-ddddddddddd3,dddddddd-dddd-dddd-dddd-ddddddddddd4'];
  comments constant text[] := ARRAY[
    'Workshop with the client|Wireframes|Frontend implementation|Code review|Bugfixing|Release preparation|Status meeting',
    'Tenant assessment|Interviews with IT|Licence analysis|Migration plan|Report writing|Steering committee',
    'Data migration scripts|Requirements|Testing|Documentation|Team meeting|Vendor evaluation'];
  p record;
  y int;
  k int;
  attempt int;
  key text;
  range_start date;
  range_end date;
  vacation numeric;
  left_days numeric;
  block_days int;
  s date;
  e date;
  plan_start date[];
  plan_end date[];
  plan_type text[];
  plan_half boolean[];
  ok boolean;
  day date;
  half boolean;
  sessions int;
  total int;
  weights double precision[];
  weight_sum double precision;
  minutes int[];
  starts timestamp[];
  clock timestamp;
  has_project boolean;
  used int;
  r double precision;
  project_total int;
  entries int;
  first_minutes int;
  main int;
  other int;
  pick int;
  subs text[];
  t_start timestamp;
  t_end timestamp;
BEGIN
  FOR p IN
    SELECT m.user_id, COALESCE(m.start_date, m.joined_at::date) AS start_date
    FROM organization_memberships m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.organization_id = org AND m.status = 'active' AND COALESCE(m.start_date, m.joined_at::date) IS NOT NULL
    ORDER BY m.user_id
  LOOP
    ------------------------------------------------------------------------------------------
    -- Absences, planned per calendar year, inserted once they are over.
    FOR y IN extract(year FROM p.start_date)::int .. extract(year FROM today)::int LOOP
      range_start := greatest(p.start_date, make_date(y, 1, 1));
      range_end := make_date(y, 12, 31);
      key := p.user_id || ':' || y;
      vacation := round((20 + floor(pg_temp.seed_rnd(key || ':vacation') * 11)) * (range_end - range_start + 1) / (make_date(y, 12, 31) - make_date(y, 1, 1) + 1.0));
      left_days := vacation;
      plan_start := '{}'; plan_end := '{}'; plan_type := '{}'; plan_half := '{}';
      k := 0;
      -- Two weeks in summer, one week elsewhere, then 1-3 days clock a time; one half day sometimes.
      WHILE left_days > 0 AND k < 40 LOOP
        k := k + 1;
        block_days := CASE
          WHEN k = 1 AND left_days >= 10 THEN 10
          WHEN k = 2 AND left_days >= 5 THEN 5
          ELSE floor(least(left_days, 1 + floor(pg_temp.seed_rnd(key || ':len:' || k) * 3)))::int END;
        -- A half day sometimes, and always for a last half day left.
        half := left_days < 1 OR (k > 2 AND pg_temp.seed_rnd(key || ':half:' || k) < 0.12);
        IF half THEN block_days := 1; END IF;
        ok := false;
        FOR attempt IN 1 .. 25 LOOP
          r := pg_temp.seed_rnd(key || ':start:' || k || ':' || attempt);
          IF block_days = 10 THEN
            s := make_date(y, 7, 1) + floor(r * 50)::int;   -- July / August
          ELSIF block_days = 5 AND r < 0.5 THEN
            s := make_date(y, 2, 1) + floor(r * 2 * 80)::int; -- February - April
          ELSIF block_days = 5 THEN
            s := make_date(y, 9, 20) + floor((r - 0.5) * 2 * 90)::int; -- autumn / Christmas
          ELSE
            s := make_date(y, 1, 1) + floor(r * 365)::int;
          END IF;
          IF block_days >= 5 THEN s := s - (extract(isodow FROM s)::int - 1); END IF; -- a Monday
          s := pg_temp.seed_next_workday(greatest(s, range_start));
          e := pg_temp.seed_span_end(s, block_days);
          CONTINUE WHEN e > range_end;
          CONTINUE WHEN EXISTS (SELECT 1 FROM generate_subscripts(plan_start, 1) i WHERE plan_start[i] <= e + 1 AND plan_end[i] >= s - 1);
          ok := true;
          EXIT;
        END LOOP;
        IF ok THEN
          plan_start := plan_start || s; plan_end := plan_end || e;
          plan_type := plan_type || 'vacation'::text; plan_half := plan_half || half;
        END IF;
        left_days := left_days - CASE WHEN half THEN 0.5 ELSE block_days END;
      END LOOP;
      -- 0-3 sick spells of 1-3 working days.
      FOR k IN 1 .. floor(pg_temp.seed_rnd(key || ':sick') * 4)::int LOOP
        FOR attempt IN 1 .. 10 LOOP
          s := pg_temp.seed_next_workday(make_date(y, 1, 1) + floor(pg_temp.seed_rnd(key || ':sick:' || k || ':' || attempt) * 365)::int);
          e := pg_temp.seed_span_end(s, 1 + floor(pg_temp.seed_rnd(key || ':sicklen:' || k) * 3)::int);
          CONTINUE WHEN s < range_start OR e > range_end;
          CONTINUE WHEN EXISTS (SELECT 1 FROM generate_subscripts(plan_start, 1) i WHERE plan_start[i] <= e + 1 AND plan_end[i] >= s - 1);
          plan_start := plan_start || s; plan_end := plan_end || e;
          plan_type := plan_type || 'sickness'::text; plan_half := plan_half || false;
          EXIT;
        END LOOP;
      END LOOP;

      FOR k IN 1 .. coalesce(array_length(plan_start, 1), 0) LOOP
        s := plan_start[k]; e := plan_end[k];
        CONTINUE WHEN e >= today;
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM absences a
          WHERE a.user_id = p.user_id AND a.organization_id = org AND a.date_start <= e AND a.date_end >= s
            AND a.id <> pg_temp.seed_id(key || ':absence:' || s));
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM work_times w
          WHERE w.user_id = p.user_id
            AND w.check_in >= (s::timestamp AT TIME ZONE tz) AND w.check_in < ((e + 1)::timestamp AT TIME ZONE tz)
            AND NOT plan_half[k]);
        INSERT INTO absences (id, organization_id, user_id, date_start, date_end, status, reviewed_by_user_id, reviewed_at, note, absence_type, half_day)
        VALUES (
          pg_temp.seed_id(key || ':absence:' || s), org, p.user_id, s, e, 'approved',
          CASE WHEN plan_type[k] = 'vacation' THEN pg_temp.seed_manager(org, p.user_id, s) END,
          CASE WHEN plan_type[k] = 'vacation' THEN ((s - 21)::timestamp + TIME '10:15') AT TIME ZONE tz ELSE ((s)::timestamp + TIME '08:05') AT TIME ZONE tz END,
          CASE WHEN plan_type[k] = 'sickness' THEN 'Flu' WHEN e - s >= 7 THEN 'Summer holidays' END,
          plan_type[k], plan_half[k])
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;

    ------------------------------------------------------------------------------------------
    -- Attendance and project time, day by day.
    FOR day IN SELECT g::date FROM generate_series(p.start_date, today - 1, INTERVAL '1 day') AS g LOOP
      CONTINUE WHEN NOT pg_temp.seed_workday(day);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM work_times w
        WHERE w.user_id = p.user_id AND w.check_in >= (day::timestamp AT TIME ZONE tz) AND w.check_in < ((day + 1)::timestamp AT TIME ZONE tz));
      has_project := EXISTS (
        SELECT 1 FROM project_times t
        WHERE t.user_id = p.user_id AND t.start_time >= (day::timestamp AT TIME ZONE tz) AND t.start_time < ((day + 1)::timestamp AT TIME ZONE tz));
      half := false;
      SELECT a.half_day INTO half FROM absences a
      WHERE a.user_id = p.user_id AND a.organization_id = org AND a.status = 'approved' AND day BETWEEN a.date_start AND a.date_end
      ORDER BY a.half_day LIMIT 1;
      IF FOUND AND NOT half THEN CONTINUE; END IF;
      half := coalesce(half, false);

      key := p.user_id || ':' || day;
      r := pg_temp.seed_rnd(key || ':sessions');
      IF half THEN
        sessions := CASE WHEN r < 0.5 THEN 1 ELSE 2 END;
        total := 225 + floor(pg_temp.seed_rnd(key || ':total') * 40)::int;
      ELSE
        sessions := CASE WHEN r < 0.15 THEN 1 WHEN r < 0.75 THEN 2 WHEN r < 0.95 THEN 3 ELSE 4 END;
        -- Around the 8-hour target (7:12 - 8:48), plus a small habit per person (-4 to +4
        -- minutes a day), so overtime balances drift apart without running away.
        total := 432 + floor(pg_temp.seed_rnd(p.user_id || ':habit') * 9)::int - 4 + floor(pg_temp.seed_rnd(key || ':total') * 97)::int;
      END IF;
      weights := '{}'; weight_sum := 0;
      FOR k IN 1 .. sessions LOOP
        weights := weights || (0.6 + pg_temp.seed_rnd(key || ':w:' || k) * 0.8);
        weight_sum := weight_sum + weights[k];
      END LOOP;
      minutes := '{}'; starts := '{}'; used := 0;
      clock := day + TIME '07:00' + make_interval(mins => floor(pg_temp.seed_rnd(key || ':start') * 91)::int);
      FOR k IN 1 .. sessions LOOP
        minutes := minutes || CASE WHEN k = sessions THEN total - used ELSE floor(total * weights[k] / weight_sum)::int END;
        used := used + minutes[k];
        IF k > 1 THEN
          -- The lunch break sits in the middle of the day; other breaks are short.
          clock := clock + make_interval(mins => CASE WHEN k = sessions / 2 + 1 THEN 30 + floor(pg_temp.seed_rnd(key || ':gap:' || k) * 31)::int
                                                 ELSE 5 + floor(pg_temp.seed_rnd(key || ':gap:' || k) * 21)::int END);
        END IF;
        starts := starts || clock;
        INSERT INTO work_times (id, user_id, organization_id, check_in, check_out)
        VALUES (pg_temp.seed_id(key || ':work:' || k), p.user_id, org, clock AT TIME ZONE tz, (clock + make_interval(mins => minutes[k])) AT TIME ZONE tz)
        ON CONFLICT (id) DO NOTHING;
        clock := clock + make_interval(mins => minutes[k]);
      END LOOP;

      -- Project time: the month's main project, sometimes a second one; 80-100% of attendance in
      -- whole 5 minutes, the first entry from the first check-in, the second from the next one.
      CONTINUE WHEN has_project;
      project_total := (floor(total * (0.8 + pg_temp.seed_rnd(key || ':ptotal') * 0.2) / 5) * 5)::int;
      entries := CASE WHEN pg_temp.seed_rnd(key || ':entries') < 0.5 OR project_total < 60 THEN 1 ELSE 2 END;
      first_minutes := CASE WHEN entries = 1 THEN project_total
                            ELSE (round(project_total * (0.35 + pg_temp.seed_rnd(key || ':split') * 0.3) / 5) * 5)::int END;
      main := 1 + floor(pg_temp.seed_rnd(p.user_id || ':' || to_char(day, 'YYYY-MM') || ':main') * 3)::int;
      other := 1 + (main + floor(pg_temp.seed_rnd(key || ':other') * 2)::int) % 3;
      t_start := starts[1];
      FOR k IN 1 .. entries LOOP
        pick := CASE WHEN k = 1 THEN main ELSE other END;
        IF k = 2 THEN t_start := greatest(coalesce(starts[2], t_end), t_end); END IF;
        t_end := t_start + make_interval(mins => CASE WHEN k = 1 THEN first_minutes ELSE project_total - first_minutes END);
        subs := string_to_array(subprojects[pick], ',');
        INSERT INTO project_times (id, user_id, organization_id, project_id, subproject_id, start_time, end_time, comment)
        VALUES (
          pg_temp.seed_id(key || ':project:' || k), p.user_id, org, projects[pick],
          nullif(subs[1 + floor(pg_temp.seed_rnd(key || ':sub:' || k) * array_length(subs, 1))::int], '')::uuid,
          t_start AT TIME ZONE tz, t_end AT TIME ZONE tz,
          (string_to_array(comments[pick], '|'))[1 + floor(pg_temp.seed_rnd(key || ':comment:' || k) * 6)::int])
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Working-time timesheets: every month from the start month to last month, submitted on the
-- 1st-2nd of the next month and approved by the manager in force clock the month's end.
INSERT INTO timesheet_periods (id, organization_id, user_id, period_start, period_end, status, submitted_at, reviewed_by_user_id, reviewed_at)
SELECT pg_temp.seed_id(m.user_id || ':timesheet:' || mo::date), m.organization_id, m.user_id, mo::date, (mo + INTERVAL '1 month')::date, 'approved',
       least(now(), ((mo + INTERVAL '1 month')::timestamp + TIME '17:30') AT TIME ZONE 'Europe/Zurich'),
       pg_temp.seed_manager(m.organization_id, m.user_id, (mo + INTERVAL '1 month - 1 day')::date),
       least(now(), ((mo + INTERVAL '1 month 2 days')::timestamp + TIME '09:10') AT TIME ZONE 'Europe/Zurich')
FROM organization_memberships m
JOIN users u ON u.id = m.user_id AND u.status = 'active'
CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(m.start_date, m.joined_at::date)),
                                   date_trunc('month', (now() AT TIME ZONE 'Europe/Zurich')::date) - INTERVAL '1 month',
                                   INTERVAL '1 month') AS mo
WHERE m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND m.status = 'active'
ON CONFLICT (organization_id, user_id, period_start) DO NOTHING;

-- Project timesheets: one per person, project and month with project time before this month,
-- approved by the project's owner.
INSERT INTO project_time_periods (id, organization_id, user_id, project_id, period_start, period_end, status, submitted_at, reviewed_by_user_id, reviewed_at)
SELECT pg_temp.seed_id(t.user_id || ':project-timesheet:' || t.project_id || ':' || t.month), t.organization_id, t.user_id, t.project_id,
       t.month, (t.month + INTERVAL '1 month')::date, 'approved',
       least(now(), ((t.month + INTERVAL '1 month')::timestamp + TIME '17:35') AT TIME ZONE 'Europe/Zurich'),
       COALESCE(pr.owner_user_id, t.user_id),
       least(now(), ((t.month + INTERVAL '1 month 3 days')::timestamp + TIME '11:00') AT TIME ZONE 'Europe/Zurich')
FROM (
  SELECT DISTINCT pt.user_id, pt.organization_id, pt.project_id, date_trunc('month', pt.start_time AT TIME ZONE 'Europe/Zurich')::date AS month
  FROM project_times pt
  WHERE pt.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND pt.project_id IS NOT NULL
    AND pt.start_time < (date_trunc('month', now() AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich')
) t
JOIN projects pr ON pr.id = t.project_id
ON CONFLICT (organization_id, user_id, project_id, period_start) DO NOTHING;

-- Expenses: 0-3 a month per person, on a weekday of that month before today, from a small
-- catalogue (category, sub-category, amount range, currency, billing).
CREATE TEMP TABLE seed_expenses ON COMMIT DROP AS
WITH kinds(n, category, sub_category, low, high, currency, billing_type, comment) AS (
  VALUES
    (0, 'travel',   'taxi',         18, 85,  'CHF', 'billable',     'Taxi to the client'),
    (1, 'travel',   'hotel',        120, 260, 'EUR', 'billable',    'Hotel, client visit'),
    (2, 'travel',   'flight',       160, 620, 'EUR', 'billable',    'Flight to workshop'),
    (3, 'meals',    'client_lunch', 45, 190, 'CHF', 'billable',     'Lunch with the client'),
    (4, 'meals',    'team_lunch',   35, 140, 'CHF', 'internal',     'Team lunch'),
    (5, 'supplies', NULL,           8, 60,   'CHF', 'non_billable', 'Office supplies'),
    (6, 'software', NULL,           10, 49,  'CHF', 'internal',     'Software subscription'),
    (7, 'other',    NULL,           12, 80,  'CHF', 'non_billable', 'Parking')
),
slots AS (
  SELECT m.user_id, m.organization_id, mo::date AS month, i,
         m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expense:' || i AS key,
         COALESCE(m.start_date, m.joined_at::date) AS start_date
  FROM organization_memberships m
  JOIN users u ON u.id = m.user_id AND u.status = 'active'
  CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(m.start_date, m.joined_at::date)),
                                     date_trunc('month', (now() AT TIME ZONE 'Europe/Zurich')::date), INTERVAL '1 month') AS mo
  CROSS JOIN generate_series(1, 3) AS i
  WHERE m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND m.status = 'active'
    AND i <= CASE WHEN pg_temp.seed_rnd(m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expenses') < 0.3 THEN 0
                  WHEN pg_temp.seed_rnd(m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expenses') < 0.65 THEN 1
                  WHEN pg_temp.seed_rnd(m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expenses') < 0.9 THEN 2 ELSE 3 END
),
dated AS (
  SELECT s.*, (s.month + floor(pg_temp.seed_rnd(s.key || ':day') * 20)::int) AS raw_day
  FROM slots s
)
SELECT pg_temp.seed_id(d.key) AS id, d.user_id, d.organization_id, d.month, pg_temp.seed_next_workday(d.raw_day) AS expense_date,
       k.category, k.sub_category, k.billing_type, k.currency AS original_currency, k.comment,
       round((k.low + pg_temp.seed_rnd(d.key || ':amount') * (k.high - k.low))::numeric, 2) AS original_value,
       CASE WHEN k.billing_type = 'billable'
            THEN (ARRAY['cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccd']::uuid[])[1 + floor(pg_temp.seed_rnd(d.key || ':project') * 2)::int]
            WHEN k.billing_type = 'internal' THEN 'cccccccc-cccc-cccc-cccc-ccccccccccce'::uuid END AS project_id
FROM dated d
JOIN kinds k ON k.n = floor(pg_temp.seed_rnd(d.key || ':kind') * 8)::int;

DELETE FROM seed_expenses
WHERE expense_date >= (now() AT TIME ZONE 'Europe/Zurich')::date
   OR expense_date < (SELECT COALESCE(m.start_date, m.joined_at::date) FROM organization_memberships m
                      WHERE m.organization_id = seed_expenses.organization_id AND m.user_id = seed_expenses.user_id)
   OR date_trunc('month', expense_date) <> month;

INSERT INTO expenses (id, user_id, organization_id, project_id, expense_date, category, sub_category, billing_type,
                      original_value, original_currency, currency, quantity, value, comment)
SELECT id, user_id, organization_id, project_id, expense_date, category, sub_category, billing_type,
       original_value, original_currency, 'CHF', CASE WHEN category = 'supplies' THEN 1 END,
       CASE WHEN original_currency = 'EUR' THEN round(original_value * 0.94, 2) ELSE original_value END, comment
FROM seed_expenses
ON CONFLICT (id) DO NOTHING;

-- One expense report per person and month with expenses: finished, approved for the last two
-- months (waiting for processing), in preparation for the current month.
INSERT INTO expense_reports (id, organization_id, user_id, status, date_submitted, reviewed_by_user_id, reviewed_at, data)
SELECT pg_temp.seed_id(r.user_id || ':expense-report:' || r.month), r.organization_id, r.user_id,
       CASE WHEN r.month = r.this_month THEN 'in_preparation'
            WHEN r.month >= r.this_month - INTERVAL '2 months' THEN 'approved' ELSE 'finished' END,
       CASE WHEN r.month < r.this_month THEN ((r.month + INTERVAL '1 month 1 day')::timestamp + TIME '16:00') AT TIME ZONE 'Europe/Zurich' END,
       CASE WHEN r.month < r.this_month THEN pg_temp.seed_manager(r.organization_id, r.user_id, (r.month + INTERVAL '1 month - 1 day')::date) END,
       CASE WHEN r.month < r.this_month THEN least(now(), ((r.month + INTERVAL '1 month 4 days')::timestamp + TIME '10:30') AT TIME ZONE 'Europe/Zurich') END,
       '{}'::jsonb
FROM (
  SELECT DISTINCT user_id, organization_id, month, date_trunc('month', (now() AT TIME ZONE 'Europe/Zurich')::date)::date AS this_month
  FROM seed_expenses
) r
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_report_items (id, expense_report_id, expense_id, organization_id)
SELECT pg_temp.seed_id(e.id || ':item'), pg_temp.seed_id(e.user_id || ':expense-report:' || e.month), e.id, e.organization_id
FROM seed_expenses e
WHERE EXISTS (SELECT 1 FROM expense_reports r WHERE r.id = pg_temp.seed_id(e.user_id || ':expense-report:' || e.month))
ON CONFLICT DO NOTHING;
