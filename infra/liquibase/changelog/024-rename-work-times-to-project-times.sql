--liquibase formatted sql

-- work_time is being renamed to project_time throughout the app: entries record
-- time booked against a project or company activity, not "work" generically.
-- This renames the table plus its indexes/constraints to match, and moves the
-- worktime:approve permission id to project-time:approve.

--changeset worktime:048-rename-work-times-to-project-times
ALTER TABLE work_times RENAME TO project_times;
ALTER TABLE project_times RENAME CONSTRAINT work_times_pkey TO project_times_pkey;
ALTER TABLE project_times RENAME CONSTRAINT work_times_user_id_fkey TO project_times_user_id_fkey;
ALTER TABLE project_times RENAME CONSTRAINT work_times_organization_id_fkey TO project_times_organization_id_fkey;
ALTER TABLE project_times RENAME CONSTRAINT work_times_project_id_fkey TO project_times_project_id_fkey;
ALTER TABLE project_times RENAME CONSTRAINT work_times_subproject_id_fkey TO project_times_subproject_id_fkey;
ALTER TABLE project_times RENAME CONSTRAINT chk_worktime_order TO chk_project_time_order;
ALTER INDEX idx_worktimes_org_start RENAME TO idx_project_times_org_start;
ALTER INDEX idx_worktimes_project RENAME TO idx_project_times_project;
ALTER INDEX idx_worktimes_user_start RENAME TO idx_project_times_user_start;

--changeset worktime:049-rename-worktime-approve-permission
-- permissions.id has no ON UPDATE CASCADE on role_permissions.permission_id, so a
-- plain rename would violate the FK — insert the new id, move grants over, then
-- drop the old one.
INSERT INTO permissions (id, description) VALUES ('project-time:approve', 'Approve submitted project times');
INSERT INTO role_permissions (role_id, permission_id)
  SELECT role_id, 'project-time:approve' FROM role_permissions WHERE permission_id = 'worktime:approve';
DELETE FROM role_permissions WHERE permission_id = 'worktime:approve';
DELETE FROM permissions WHERE id = 'worktime:approve';
