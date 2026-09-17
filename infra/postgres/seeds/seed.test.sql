-- seed.dev.sql — demo users, org, roles, project + project times + static data.
-- Depends on schema.sql + 002-worktime-extensions.sql.

INSERT INTO organizations (id, slug, name, type, country, created_by_user_id, is_active)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'acme', 'Acme Corp', 'enterprise', 'CH', '11111111-1111-1111-1111-111111111111', TRUE),
  -- Second org so the web app's organization switcher has something to switch between in the demo.
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'glox', 'Glox Inc', 'team', 'US', '11111111-1111-1111-1111-111111111111', TRUE)
ON CONFLICT (slug) DO NOTHING;


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

INSERT INTO public.roles(id, organization_id, "name", description, is_system_role, settings, translations, admin_user_ids) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, NULL, 'owner', 'Full organization owner and legal contact', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000002'::uuid, NULL, 'admin', 'Organization administrator', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000003'::uuid, NULL, 'member', 'Standard collaborator with read/write access', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000004'::uuid, NULL, 'guest', 'Restricted access to assigned teams/projects only', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000005'::uuid, NULL, 'billing_admin', 'Can manage billing and subscription tiers only', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000006'::uuid, NULL, 'manager', 'Manager with team, project, and subproject access', true, '{}'::jsonb, '{}'::jsonb, '{}');
ON CONFLICT ("name") DO NOTHING;

-- Memberships: admin->admin role, manager->manager role, user->member role
INSERT INTO organization_memberships (id, organization_id, user_id, status, role_id)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active','00000000-0000-0000-0000-000000000001'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active','00000000-0000-0000-0000-000000000002'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'active','00000000-0000-0000-0000-000000000002'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222223', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222223', 'active','00000000-0000-0000-0000-000000000002'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222224', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222224', 'active','00000000-0000-0000-0000-000000000006'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222225', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222225', 'active','00000000-0000-0000-0000-000000000006'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222226', 'active','00000000-0000-0000-0000-000000000003'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222227', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222227', 'active','00000000-0000-0000-0000-000000000003'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222228', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222228', 'active','00000000-0000-0000-0000-000000000003'::uuid),

  -- admin is also admin of Glox; manager is only a plain member there — same person, different role per org.
  ('eeeeeeee-eeee-eeee-eeee-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'active', '00000000-0000-0000-0000-000000000001'::uuid),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222228', 'active', '00000000-0000-0000-0000-000000000003'::uuid)
ON CONFLICT (organization_id, user_id) DO UPDATE SET status = EXCLUDED.status;

-- Roles per membership (a membership can hold more than one; each of these holds exactly one for now).
INSERT INTO membership_roles (membership_id, role_id)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', '00000000-0000-0000-0000-000000000002'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', '00000000-0000-0000-0000-000000000006'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333333', '00000000-0000-0000-0000-000000000003'),
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '00000000-0000-0000-0000-000000000002'),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', '00000000-0000-0000-0000-000000000003')
ON CONFLICT (membership_id, role_id) DO NOTHING;

INSERT INTO teams (id, organization_id, name, description, lead_user_id)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Platform', 'Platform team', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO team_members (team_id, membership_id)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-333333333333')
ON CONFLICT (team_id, membership_id) DO NOTHING;


INSERT INTO projects (id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Website Relaunch', '22222222-2222-2222-2222-222222222222', 'COST-100', 'customer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subprojects (id, project_id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Design phase', '22222222-2222-2222-2222-222222222222', 'COST-101', 'phase')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_times (user_id, organization_id, project_id, subproject_id, start_time, end_time, comment)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours', 'Homepage hero'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '90 minutes', 'Bugfix')
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

UPDATE roles SET translations = translations || '{"de":"Administrator"}'::jsonb WHERE id = '00000000-0000-0000-0000-000000000002';
UPDATE roles SET translations = translations || '{"de":"Manager"}'::jsonb WHERE id = '00000000-0000-0000-0000-000000000006';
UPDATE roles SET translations = translations || '{"de":"Benutzer"}'::jsonb WHERE id = '00000000-0000-0000-0000-000000000003';


-- Local password identities for the demo users (password: dev1234).
-- Lets the web login screen sign in without Keycloak.
INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'password', 'admin@acme.example', '$2a$10$HMj/faWgnuJJkTNdemEJOu.tCHf5D1BNsIOoop/8nm46l2lB8P.q6'),
  ('22222222-2222-2222-2222-222222222222', 'password', 'manager@acme.example', '$2a$10$HMj/faWgnuJJkTNdemEJOu.tCHf5D1BNsIOoop/8nm46l2lB8P.q6'),
  ('33333333-3333-3333-3333-333333333333', 'password', 'user@acme.example', '$2a$10$HMj/faWgnuJJkTNdemEJOu.tCHf5D1BNsIOoop/8nm46l2lB8P.q6')
ON CONFLICT DO NOTHING;

-- Pending invitation for the login screen's "invited user" demo (token: dev-invite-0001).
INSERT INTO organization_invitations (organization_id, email, role_id, token, invited_by_user_id, status, expires_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'invited@acme.example', '00000000-0000-0000-0000-000000000003', 'dev-invite-0001', '11111111-1111-1111-1111-111111111111', 'pending', '2030-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

-- Demo expenses for the `user` demo account. The third one is left unmapped to any
-- report, to exercise the "nothing attached yet" empty state in the report builder.
INSERT INTO expenses (id, user_id, organization_id, project_id, subproject_id, expense_date, category, sub_category, billing_type, original_value, original_currency, currency, quantity, comment)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, (NOW() - INTERVAL '5 days')::date, 'travel', 'taxi', 'billable', 45.00, 'EUR', 'CHF', NULL, 'Taxi to client site'),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, (NOW() - INTERVAL '5 days')::date, 'meals', 'client_lunch', 'billable', 60.00, 'EUR', 'CHF', NULL, 'Lunch with client'),
  ('eeeeeeee-eeee-eeee-eeee-333333333333', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, NULL, (NOW() - INTERVAL '1 day')::date, 'supplies', NULL, 'non_billable', 25.50, 'CHF', 'CHF', 1, 'USB-C cable')
ON CONFLICT (id) DO NOTHING;

-- Demo report bundling the first two expenses above, already submitted for manager approval.
INSERT INTO expense_reports (id, organization_id, user_id, status, date_submitted, data)
VALUES ('ffffffff-ffff-ffff-ffff-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'submitted', NOW() - INTERVAL '4 days', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_report_items (expense_report_id, expense_id, organization_id)
VALUES
  ('ffffffff-ffff-ffff-ffff-111111111111', 'eeeeeeee-eeee-eeee-eeee-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('ffffffff-ffff-ffff-ffff-111111111111', 'eeeeeeee-eeee-eeee-eeee-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (expense_id) DO NOTHING;
