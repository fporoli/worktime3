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

INSERT INTO roles(id, organization_id, "name", description, is_system_role, settings, translations, admin_user_ids) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, NULL, 'owner', 'Full organization owner and legal contact', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000002'::uuid, NULL, 'admin', 'Organization administrator', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000003'::uuid, NULL, 'member', 'Standard collaborator with read/write access', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000004'::uuid, NULL, 'guest', 'Restricted access to assigned teams/projects only', true, '{}'::jsonb, '{}'::jsonb, '{}'),
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

-- Acme reporting lines (organization_memberships.manager_user_id; approvals route to that person):
--   Alice  -> Admin, Adam
--   Adam   -> Marta, Marco, Uma
--   Marta  -> Ulla
--   Marco  -> Ueli
-- An UPDATE rather than a column in the INSERT above, so re-running the seed fills in rows that
-- exist without a manager; a manager someone set since is left alone.
UPDATE organization_memberships m
SET manager_user_id = v.manager_user_id::uuid
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'), -- Admin <- Alice
  ('22222222-2222-2222-2222-222222222223', '22222222-2222-2222-2222-222222222222'), -- Adam  <- Alice
  ('22222222-2222-2222-2222-222222222224', '22222222-2222-2222-2222-222222222223'), -- Marta <- Adam
  ('22222222-2222-2222-2222-222222222225', '22222222-2222-2222-2222-222222222223'), -- Marco <- Adam
  ('22222222-2222-2222-2222-222222222228', '22222222-2222-2222-2222-222222222223'), -- Uma   <- Adam
  ('22222222-2222-2222-2222-222222222226', '22222222-2222-2222-2222-222222222224'), -- Ulla  <- Marta
  ('22222222-2222-2222-2222-222222222227', '22222222-2222-2222-2222-222222222225')  -- Ueli  <- Marco
) AS v(user_id, manager_user_id)
WHERE m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  AND m.user_id = v.user_id::uuid
  AND m.manager_user_id IS NULL;

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
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Website Relaunch', '22222222-2222-2222-2222-222222222222', 'COST-100', 'customer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subprojects (id, project_id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Design phase', '22222222-2222-2222-2222-222222222222', 'COST-101', 'phase')
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

-- Global (organization_id = NULL) languages (locales) and countries (nations, countries) applying to all organizations.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES
  (NULL, 'users', 'locales', $wtjson${"de":"Deutsch","fr":"Français","it":"Italiano","rm":"Rumantsch","en":"English","es":"Spanish","pt":"Portuguese","cs":"Czech","sk":"Slovak","pl":"Polish","other":"Others"}$wtjson$::jsonb, $wtjson${"en":{"de":"German","fr":"French","it":"Italian","rm":"Romansh","en":"English","es":"Spanish","pt":"Portuguese","cs":"Czech","sk":"Slovak","pl":"Polish","other":"Others"},"de":{"de":"Deutsch","fr":"Französisch","it":"Italienisch","rm":"Rätoromanisch","en":"Englisch","es":"Spanisch","pt":"Portugiesisch","cs":"Tschechisch","sk":"Slowakisch","pl":"Polnisch","other":"Andere"},"fr":{"de":"Allemand","fr":"Français","it":"Italien","rm":"Romanche","en":"Anglais","es":"Espagnol","pt":"Portugais","cs":"Tchèque","sk":"Slovaque","pl":"Polonais","other":"Autres"},"it":{"de":"Tedesco","fr":"Francese","it":"Italiano","rm":"Romancio","en":"Inglese","es":"Spagnolo","pt":"Portoghese","cs":"Ceco","sk":"Slovacco","pl":"Polacco","other":"Altri"}}$wtjson$::jsonb),
  (NULL, 'users', 'nations', $wtjson${"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}$wtjson$::jsonb, $wtjson${"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}$wtjson$::jsonb),
  (NULL, 'users', 'countries', $wtjson${"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}$wtjson$::jsonb, $wtjson${"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}$wtjson$::jsonb)
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

-- Demo-account dropdown on the login screen (GET /auth/demo-accounts, public). Global row.
-- Key = dropdown order; value = a JSON string {name, user, password}, kept a string so the
-- Admin Settings static-data editor (flat key -> text) can still show and edit it.
-- Only seeded databases have this row, so production login screens show no dropdown. The other
-- demo users still sign in by typing their email and password.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES (NULL, 'login', 'demo_accounts', $wtjson${
  "01": "{\"name\":\"Admin (Acme)\",\"user\":\"admin@acme.com\",\"password\":\"admin\"}",
  "02": "{\"name\":\"Manager (Acme)\",\"user\":\"marta@acme.com\",\"password\":\"marta\"}",
  "03": "{\"name\":\"User (Acme)\",\"user\":\"ulla@acme.com\",\"password\":\"ulla\"}"
}$wtjson$::jsonb, '{}'::jsonb)
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
