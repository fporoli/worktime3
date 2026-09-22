-- seed.dev.sql — demo users, org, roles, project + project times + static data.
-- Depends on schema.sql + 002-worktime-extensions.sql.

INSERT INTO organizations (id, slug, name, type, country, is_active)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'acme', 'Acme Corp', 'enterprise', 'CH', TRUE),
  -- Second org so the web app's organization switcher has something to switch between in the demo.
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'glox', 'Glox Inc', 'team', 'US', TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (id, email, display_name, first_name, last_name, locale, timezone, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@acme.com', 'Acme Glox Admin', 'Adam',   'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'alice@acme.com', 'Alice A',         'Alice',  'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222223', 'adam@acme.com',  'Adam A' ,         'Adam',   'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222224', 'marta@acme.com', 'Marta A',         'Marta',  'Manager', 'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222225', 'marc@acme.com',  'Marc A',          'Marc',   'Manager', 'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222226', 'ulla@acme.com',  'Ulla A' ,         'Ulla',   'User',    'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222227', 'ueli@acme.com',  'Ueli A' ,         'Ueli',   'User',    'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222228', 'uma@acme.com',   'Uma A'  ,         'Uma',    'User',    'en', 'Europe/Zurich', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'udo@glox.com',   'Udo G',           'Udo',    'Glox',    'en', 'America/New_York', 'active')
ON CONFLICT (email) DO NOTHING;

-- Local password identities for the demo users (password: change-me).
-- Lets the web login screen sign in without Keycloak.
INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'password', 'admin@acme.com',   '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('22222222-2222-2222-2222-222222222222', 'password', 'alice@acme.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('22222222-2222-2222-2222-222222222223', 'password', 'adam@acme.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('22222222-2222-2222-2222-222222222224', 'password', 'marta@acme.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('22222222-2222-2222-2222-222222222225', 'password', 'marc@acme.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('22222222-2222-2222-2222-222222222226', 'password', 'ulla@acme.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('22222222-2222-2222-2222-222222222227', 'password', 'ueli@acme.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('22222222-2222-2222-2222-222222222228', 'password', 'uma@acme.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W'),
  ('33333333-3333-3333-3333-333333333333', 'password', 'udo@glox.com', '$2a$10$bYfa.Sj1szDSn43Q41WBQeuARx5OMN7/cV9.rxaFLq/JuEX7f8k.W')
ON CONFLICT DO NOTHING;

INSERT INTO roles (id, organization_id, name, description, is_system_role, settings, translations, admin_user_ids) 
VALUES ('00000000-0000-0000-0000-000000000001', NULL, 'owner', 'Full organization owner and legal contact', true, '{}', '{}', '{}'),
       ('00000000-0000-0000-0000-000000000002', NULL, 'admin', 'Organization administrator', true, '{}', '{"de": "Administrator"}', '{}'),
       ('00000000-0000-0000-0000-000000000003', NULL, 'manager', 'Manager with team, project, and subproject access', true, '{}', '{"de": "Manager"}', '{}'),
       ('00000000-0000-0000-0000-000000000004', NULL, 'hr', 'Can review and correct employees basic/personal data', true, '{}', '{}', '{}'),
       ('00000000-0000-0000-0000-000000000006', NULL, 'billing_admin', 'Can manage billing and subscription tiers only', true, '{}', '{}', '{}'),
       ('00000000-0000-0000-0000-000000000008', NULL, 'member', 'Standard collaborator with read/write access', true, '{}', '{"de": "Benutzer"}', '{}'),       
       ('00000000-0000-0000-0000-000000000009', NULL, 'guest', 'Restricted access to assigned teams/projects only', true, '{}', '{}', '{}')
ON CONFLICT (organization_id, name) DO NOTHING;

-- Memberships: admin->admin role, manager->manager role, user->member role
INSERT INTO organization_memberships (id, organization_id, user_id, status, role_ids, manager_user_id)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', ARRAY['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002']::uuid[], NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'active', ARRAY['00000000-0000-0000-0000-000000000002']::uuid[], '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222223', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222223', 'active', ARRAY['00000000-0000-0000-0000-000000000002']::uuid[], '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222224', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222224', 'active', ARRAY['00000000-0000-0000-0000-000000000003']::uuid[], '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222225', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222225', 'active', ARRAY['00000000-0000-0000-0000-000000000003']::uuid[], '22222222-2222-2222-2222-222222222223'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222226', 'active', ARRAY['00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000004']::uuid[], '22222222-2222-2222-2222-222222222224'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222227', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222227', 'active', ARRAY['00000000-0000-0000-0000-000000000008']::uuid[], '22222222-2222-2222-2222-222222222225'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222228', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222228', 'active', ARRAY['00000000-0000-0000-0000-000000000008']::uuid[], '22222222-2222-2222-2222-222222222225'),

  -- admin is also admin of Glox; manager is only a plain member there — same person, different role per org.
  ('eeeeeeee-eeee-eeee-eeee-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'active', ARRAY['00000000-0000-0000-0000-000000000001']::uuid[], NULL),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '33333333-3333-3333-3333-333333333333', 'active', ARRAY['00000000-0000-0000-0000-000000000002']::uuid[],'11111111-1111-1111-1111-111111111111')
ON CONFLICT (organization_id, user_id) DO NOTHING; 

INSERT INTO teams (id, organization_id, name, description, lead_user_id) VALUES 
  ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Platform', 'Platform team', '22222222-2222-2222-2222-222222222222'),
  ('00000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Dev Team', 'Development team gurus', '22222222-2222-2222-2222-222222222222'),
  ('00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fantasy Team', null, '33333333-3333-3333-3333-333333333333'),
  ('00000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Globx Team', null, null),
  ('00000000-0000-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Globx Dev Team', null, null)
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO team_members (team_id, membership_id)
VALUES 
('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222222'),
('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222224'),
('00000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222223'),
('00000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222225'),
('00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222222'),
('00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222226'),
('00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222227'),
('00000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-111111111111'),
('00000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-222222222222'),
('00000000-0000-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-222222222222')
ON CONFLICT (team_id, membership_id) DO NOTHING;

INSERT INTO static_data (id, entity, entity_uuid, enum_name, values, translation, organization_id) VALUES 
('6ecd71f7-e890-41cc-b984-6375a3a9b81b', 'projects', null, 'project_type', '{"customer": "Customer", "internal": "Internal", "research": "Research"}', '{"de": {"internal": "Intern"}}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('7d570c9a-d045-4bdb-90b2-b1e924cd9bfd', 'organization_memberships', null, 'membership_status', '{"active": "Active", "invited": "Invited", "suspended": "Suspended"}', '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('c4ddcea1-436c-40a4-9bc0-48db61bdf0ad', 'project_times', null, 'billability', '{"billable": "Billable", "non_billable": "Non billable"}', '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('ed8d7588-9dd5-4628-93c9-491308649f05', 'expenses', null, 'expense_category', '{"meals": "Meals & Entertainment", "other": "Other", "travel": "Travel", "software": "Software & Subscriptions", "supplies": "Office Supplies"}', '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('46545551-d27c-4319-80ca-0c40c1edf55c', 'expenses', null, 'expense_subcategory', '{"travel$taxi": "Taxi/Rideshare", "travel$hotel": "Hotel", "travel$flight": "Flight", "meals$team_lunch": "Team Lunch", "meals$client_lunch": "Client Lunch"}', '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('86249010-1b23-4fc7-ba9d-d11c58d03142', 'expenses', null, 'billing_type', '{"billable": "Billable to client", "internal": "Internal / overhead", "non_billable": "Non-billable"}', '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (organization_id,entity,enum_name)  DO NOTHING;

INSERT INTO projects (id, organization_id, name, owner_user_id, cost_item, type)
VALUES 
('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Website Relaunch', '11111111-1111-1111-1111-111111111111', 'COST-100', 'internal'),
('cccccccc-cccc-cccc-cccc-ccccccccccc2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'New CRM Platform', '22222222-2222-2222-2222-222222222224', 'COST-101', 'research'),
('cccccccc-cccc-cccc-cccc-ccccccccccc3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Teams Telephone', '22222222-2222-2222-2222-222222222223', 'COST-102', 'customer'),
('cccccccc-cccc-cccc-cccc-ccccccccccc4', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Client XY', '22222222-2222-2222-2222-222222222223', 'COST-103', 'customer'),
('cccccccc-cccc-cccc-cccc-ccccccccccc5', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Website Relaunch', '33333333-3333-3333-3333-333333333333', 'COST-100', 'internal')
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO subprojects (id, project_id, organization_id, name, owner_user_id, cost_item, type)
VALUES 
('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Design phase', '22222222-2222-2222-2222-222222222222', 'COST-100a', 'phase'),
('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Implementation phase', '22222222-2222-2222-2222-222222222222', 'COST-100b', 'phase')
ON CONFLICT (project_id, name) DO NOTHING;

INSERT INTO project_times (user_id, organization_id, project_id, subproject_id, start_time, end_time, comment)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours', 'Homepage hero'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '90 minutes', 'Bugfix')
ON CONFLICT DO NOTHING;

-- Pending invitation for the login screen's "invited user" demo (token: dev-invite-0001).
INSERT INTO organization_invitations (organization_id, email, role_id, token, invited_by_user_id, status, expires_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'invited@acme.com', '00000000-0000-0000-0000-000000000003', 'dev-invite-0001', '22222222-2222-2222-2222-222222222223', 'pending', '2030-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO permissions (id, description) VALUES 
('org:admin', 'Full administrative access to organization settings and billing'),
('org:billing', 'Manage subscriptions, payment methods, and invoices'),
('members:manage', 'Invite, modify, and remove members'),
('teams:manage', 'Create and modify team structures'),
('sso:configure', 'Configure SAML/OIDC and domain verifications'),
('audit:read', 'Export and inspect enterprise audit logs'),
('data:read', 'Read resources inside organization'),
('data:write', 'Create and edit resources inside organization'),
('projects:manage', 'Create and manage projects and subprojects'),
('project-time:approve', 'Approve submitted project times')
on conflict (id) do nothing;

INSERT INTO role_permissions (role_id, permission_id) VALUES 
('00000000-0000-0000-0000-000000000001', 'org:admin'),
('00000000-0000-0000-0000-000000000001', 'org:billing'),
('00000000-0000-0000-0000-000000000001', 'members:manage'),
('00000000-0000-0000-0000-000000000001', 'teams:manage'),
('00000000-0000-0000-0000-000000000001', 'sso:configure'),
('00000000-0000-0000-0000-000000000001', 'audit:read'),
('00000000-0000-0000-0000-000000000001', 'data:read'),
('00000000-0000-0000-0000-000000000001', 'data:write'),
('00000000-0000-0000-0000-000000000002', 'org:admin'),
('00000000-0000-0000-0000-000000000002', 'members:manage'),
('00000000-0000-0000-0000-000000000002', 'teams:manage'),
('00000000-0000-0000-0000-000000000002', 'sso:configure'),
('00000000-0000-0000-0000-000000000002', 'audit:read'),
('00000000-0000-0000-0000-000000000002', 'data:read'),
('00000000-0000-0000-0000-000000000002', 'data:write'),
('00000000-0000-0000-0000-000000000003', 'data:read'),
('00000000-0000-0000-0000-000000000003', 'data:write'),
('00000000-0000-0000-0000-000000000004', 'data:read'),
('00000000-0000-0000-0000-000000000005', 'org:billing'),
('00000000-0000-0000-0000-000000000001', 'projects:manage'),
('00000000-0000-0000-0000-000000000002', 'projects:manage'),
('00000000-0000-0000-0000-000000000006', 'members:manage'),
('00000000-0000-0000-0000-000000000006', 'teams:manage'),
('00000000-0000-0000-0000-000000000006', 'data:read'),
('00000000-0000-0000-0000-000000000006', 'data:write'),
('00000000-0000-0000-0000-000000000006', 'projects:manage'),
('00000000-0000-0000-0000-000000000001', 'project-time:approve'),
('00000000-0000-0000-0000-000000000002', 'project-time:approve')
on conflict (role_id, permission_id) do nothing;

-- Demo expenses for the `user` demo account. The third one is left unmapped to any
-- report, to exercise the "nothing attached yet" empty state in the report builder.
INSERT INTO expenses (id, user_id, organization_id, project_id, subproject_id, expense_date, category, sub_category, billing_type, original_value, original_currency, currency, quantity, comment)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', NULL, (NOW() - INTERVAL '5 days')::date, 'travel', 'taxi', 'billable', 45.00, 'EUR', 'CHF', NULL, 'Taxi to client site'),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', NULL, (NOW() - INTERVAL '5 days')::date, 'meals', 'client_lunch', 'billable', 60.00, 'EUR', 'CHF', NULL, 'Lunch with client'),
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

--
-- Data for Name: workflow_definitions; Type: TABLE DATA; Schema: public; Owner: worktime
--

INSERT INTO workflow_definitions (workflow_def_id, organization_id, name, description, steps) 
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'approve absence', 'A vacation request awaiting the employee''s manager to approve or reject it.', 
  '[{"key": "manager_review", "label": "Manager review", "source": "Vacation Request", "assignTo": "manager", "onReject": {"action": "absence.reject"}, "onApprove": {"action": "absence.approve"}, "source_name": "getAbsenceTitle"}]'),

  ('11111111-1111-1111-1111-111111111112', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'reopen approved timesheet', 'An employee''s request to reopen a month their manager already approved, for correction.', 
  '[{"key": "manager_review", "label": "Manager review", "source": "Timesheet Period", "assignTo": "manager", "onReject": {"action": "none"}, "onApprove": {"action": "timesheet.reopen"}, "source_name": "getSourceTitle"}]'),

  ('11111111-1111-1111-1111-111111111113', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'approve expense report', 'A submitted expense report awaiting the employee''s manager to approve or reject it.', 
  '[{"key": "manager_review", "label": "Manager review", "source": "Expense Report", "assignTo": "manager", "onReject": {"action": "expense.reject"}, "onApprove": {"action": "expense.approve"}, "source_name": "getExpenseReportTitle"}]'),

  ('11111111-1111-1111-1111-111111111114', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'approve timesheet', 'A submitted month awaiting the employee''s manager to approve or reject it.', 
  '[{"key": "manager_review", "label": "Manager review", "source": "Timesheet Period", "assignTo": "manager", "onReject": {"action": "timesheet.reject"}, "onApprove": {"action": "timesheet.approve"}, "source_name": "getSourceTitle"}]')
ON conflict (workflow_def_id) DO NOTHING;