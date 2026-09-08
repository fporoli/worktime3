-- seed.dev.sql — demo users, org, roles, project + work times + static data.
-- Depends on schema.sql + 002-worktime-extensions.sql.

INSERT INTO users (id, email, display_name, first_name, last_name, locale, timezone, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@acme.example', 'Acme Admin', 'Ada', 'Admin', 'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'manager@acme.example', 'Marta Manager', 'Marta', 'Manager', 'en', 'Europe/Zurich', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'user@acme.example', 'Uli User', 'Uli', 'User', 'en', 'Europe/Zurich', 'active')
ON CONFLICT (email) DO NOTHING;

INSERT INTO organizations (id, slug, name, type, country, created_by_user_id, is_active)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'acme', 'Acme Corp', 'enterprise', 'CH', '11111111-1111-1111-1111-111111111111', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Memberships: admin->admin role, manager->admin role, user->member role
INSERT INTO organization_memberships (organization_id, user_id, role_id, status)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000002', 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000003', 'active')
ON CONFLICT (organization_id, user_id) DO NOTHING;

INSERT INTO teams (id, organization_id, name, description)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Platform', 'Platform team')
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO projects (id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Website Relaunch', '22222222-2222-2222-2222-222222222222', 'COST-100', 'customer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subprojects (id, project_id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Design phase', '22222222-2222-2222-2222-222222222222', 'COST-101', 'phase')
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_times (user_id, organization_id, project_id, subproject_id, start_time, end_time, comment)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours', 'Homepage hero'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '90 minutes', 'Bugfix')
ON CONFLICT DO NOTHING;

INSERT INTO static_data (entity, enum_name, "values", translation)
VALUES
  ('projects', 'project_type', '{"internal":"Internal","customer":"Customer","research":"Research"}', '{"de":{"internal":"Intern"}}'),
  ('organization_memberships', 'membership_status', '{"active":"Active","invited":"Invited","suspended":"Suspended"}', '{}'),
  ('work_times', 'billability', '{"billable":"Billable","non_billable":"Non billable"}', '{}')
ON CONFLICT DO NOTHING;

INSERT INTO role_translations (role_id, locale, display_name)
VALUES
  ('00000000-0000-0000-0000-000000000002', 'de', 'Administrator'),
  ('00000000-0000-0000-0000-000000000003', 'de', 'Benutzer')
ON CONFLICT DO NOTHING;

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
