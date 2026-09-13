--liquibase formatted sql

-- created_at/updated_at are dropped from every regular table — that
-- information now lives in versions.history instead, written by the app on
-- every insert/update/delete (see VersionsService). Left untouched:
-- versions itself (created/lastmodified are its own bookkeeping, not
-- something it tracks about itself), audit_logs (a separate, pre-existing
-- append-only admin-action log, not a per-record version history), and
-- membership_roles/role_permissions/team_members' composite-key rows other
-- than team_members.created_at (team_members has no single-uuid primary key,
-- so it can't be versioned by this mechanism either, but the column is still
-- dropped for consistency).

--changeset worktime:038-drop-created-updated-columns
ALTER TABLE user_identities DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE organization_domains DROP COLUMN created_at;
ALTER TABLE users DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE organization_invitations DROP COLUMN created_at;
ALTER TABLE roles DROP COLUMN created_at;
ALTER TABLE projects DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE subprojects DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE work_times DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE static_data DROP COLUMN created_at;
ALTER TABLE timesheet_periods DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE teams DROP COLUMN created_at;
ALTER TABLE organizations DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE organization_memberships DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE workflow_definitions DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE workflows DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE team_members DROP COLUMN created_at;
