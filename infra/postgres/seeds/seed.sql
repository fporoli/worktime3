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
  ('22222222-2222-2222-2222-222222222222', 2024-01-01, 'dddddddd-0000-0000-0000-000000000001', 'Managing Director', NULL),                                    -- Alice
  ('11111111-1111-1111-1111-111111111111', 2024-12-01, 'dddddddd-0000-0000-0000-000000000001', 'System Administrator', '22222222-2222-2222-2222-222222222222'), -- Admin <- Alice
  ('22222222-2222-2222-2222-222222222223', 2025-01-01, 'dddddddd-0000-0000-0000-000000000005', 'Head of R&D', '22222222-2222-2222-2222-222222222222'),          -- Adam  <- Alice
  ('22222222-2222-2222-2222-222222222224', 2024-03-01, 'dddddddd-0000-0000-0000-000000000003', 'Head of Sales', '22222222-2222-2222-2222-222222222223'),        -- Marta <- Adam
  ('22222222-2222-2222-2222-222222222225', 2026-01-01, 'dddddddd-0000-0000-0000-000000000005', 'Team Lead', '22222222-2222-2222-2222-222222222223'),            -- Marco <- Adam
  ('22222222-2222-2222-2222-222222222228', 2026-05-01, 'dddddddd-0000-0000-0000-000000000005', 'Software Developer', '22222222-2222-2222-2222-222222222223'),   -- Uma   <- Adam
  ('22222222-2222-2222-2222-222222222226', 2026-01-01, 'dddddddd-0000-0000-0000-000000000002', 'HR Specialist', '22222222-2222-2222-2222-222222222224'),        -- Ulla  <- Marta
  ('22222222-2222-2222-2222-222222222227', 2024-03-01, 'dddddddd-0000-0000-0000-000000000003', 'Sales Assistant', '22222222-2222-2222-2222-222222222224'),      -- Ueli  <- Marta (Sales)
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

-- Demo work time (attendance, work_times) for every active user, in their oldest organization:
-- 100 sessions in the previous month and 50 in the current one, on weekdays before today
-- (Europe/Zurich). Each day holds about 7.5-9 hours of work, split into its sessions (random
-- lengths), starting between 07:00 and 08:30 with 5-30 minute breaks between sessions.
-- A month in which the user already has any work time is skipped: that is how an earlier demo
-- run (or real data) is recognized, so re-seeding never adds a second set or overlaps them.
-- Times are random, so each fresh database gets different values.
WITH params AS (
  SELECT (now() AT TIME ZONE 'Europe/Zurich')::date AS today
),
months AS (
  SELECT v.entries, (date_trunc('month', p.today) + make_interval(months => v.month_offset))::date AS month_start
  FROM params p
  CROSS JOIN (VALUES (-1, 100), (0, 50)) AS v(month_offset, entries)
),
days AS (
  SELECT mo.month_start, d::date AS day,
         (row_number() OVER (PARTITION BY mo.month_start ORDER BY d) - 1)::int AS day_idx,
         (count(*) OVER (PARTITION BY mo.month_start))::int AS n_days
  FROM months mo
  CROSS JOIN params p
  CROSS JOIN generate_series(mo.month_start, (mo.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date, INTERVAL '1 day') AS d
  WHERE extract(isodow FROM d) < 6 AND d::date < p.today
),
people AS (
  SELECT DISTINCT ON (m.user_id) m.user_id, m.organization_id
  FROM organization_memberships m
  JOIN users u ON u.id = m.user_id AND u.status = 'active'
  WHERE m.status = 'active'
  ORDER BY m.user_id, m.joined_at, m.organization_id
),
targets AS (
  SELECT pe.user_id, pe.organization_id, mo.month_start, mo.entries
  FROM people pe
  CROSS JOIN months mo
  WHERE NOT EXISTS (
    SELECT 1 FROM work_times w
    WHERE w.user_id = pe.user_id
      AND w.check_in >= (mo.month_start::timestamp AT TIME ZONE 'Europe/Zurich')
      AND w.check_in < ((mo.month_start + INTERVAL '1 month')::timestamp AT TIME ZONE 'Europe/Zurich')
  )
),
-- Entry i of a month goes to that month's weekday (i mod weekdays), so sessions spread evenly.
slots AS (
  SELECT t.user_id, t.organization_id, d.day, i,
         0.6 + random() * 0.8 AS weight,
         5 + floor(random() * 26)::int AS gap_before
  FROM targets t
  CROSS JOIN generate_series(0, t.entries - 1) AS i
  JOIN days d ON d.month_start = t.month_start AND d.day_idx = i % d.n_days
),
day_plan AS (
  SELECT user_id, day,
         (day + TIME '07:00')::timestamp + make_interval(mins => floor(random() * 91)::int) AS day_start,
         450 + floor(random() * 91)::int AS total_minutes
  FROM slots
  GROUP BY user_id, day
),
sessions AS (
  SELECT s.user_id, s.organization_id, dp.day_start,
         row_number() OVER w AS n,
         greatest(15, floor(dp.total_minutes * s.weight / sum(s.weight) OVER (PARTITION BY s.user_id, s.day)))::int AS minutes,
         s.gap_before,
         s.day
  FROM slots s
  JOIN day_plan dp ON dp.user_id = s.user_id AND dp.day = s.day
  WINDOW w AS (PARTITION BY s.user_id, s.day ORDER BY s.i)
),
timed AS (
  SELECT user_id, organization_id, minutes,
         day_start + make_interval(mins => (
           sum(minutes + CASE WHEN n = 1 THEN 0 ELSE gap_before END)
             OVER (PARTITION BY user_id, day ORDER BY n) - minutes)::int) AS local_in
  FROM sessions
)
INSERT INTO work_times (user_id, organization_id, check_in, check_out)
SELECT user_id, organization_id,
       local_in AT TIME ZONE 'Europe/Zurich',
       (local_in + make_interval(mins => minutes)) AT TIME ZONE 'Europe/Zurich'
FROM timed;
