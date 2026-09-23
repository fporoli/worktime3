--liquibase formatted sql

-- timesheet_periods becomes project_timesheets: it's the monthly from/to
-- approval window that groups and locks project_times entries, so naming
-- it to sit next to project_times makes that pairing obvious when reading
-- the schema. work_times (the attendance clock) is unrelated and keeps its
-- name.

--changeset worktime:068-rename-timesheet-periods-to-project-timesheets
ALTER TABLE timesheet_periods RENAME TO project_timesheets;
ALTER TABLE project_timesheets RENAME CONSTRAINT timesheet_periods_pkey TO project_timesheets_pkey;
ALTER TABLE project_timesheets RENAME CONSTRAINT timesheet_periods_organization_id_fkey TO project_timesheets_organization_id_fkey;
ALTER TABLE project_timesheets RENAME CONSTRAINT timesheet_periods_user_id_fkey TO project_timesheets_user_id_fkey;
ALTER TABLE project_timesheets RENAME CONSTRAINT timesheet_periods_reviewed_by_user_id_fkey TO project_timesheets_reviewed_by_user_id_fkey;
ALTER TABLE project_timesheets RENAME CONSTRAINT uq_timesheet_period TO uq_project_timesheet;
ALTER TABLE project_timesheets RENAME CONSTRAINT chk_timesheet_period_order TO chk_project_timesheet_order;
ALTER INDEX idx_timesheet_periods_org_status RENAME TO idx_project_timesheets_org_status;
ALTER INDEX idx_timesheet_periods_user RENAME TO idx_project_timesheets_user;

--changeset worktime:069-rename-timesheet-periods-source-table-references
-- workflows/notifications/work_time_balance_entries/versions all record which
-- table a row belongs to as a plain string (there's no FK to enforce it, so
-- generic lookups by table name can work across any source table) — rewrite
-- existing rows so those lookups still find them under the new name.
UPDATE workflows SET source_table = 'project_timesheets' WHERE source_table = 'timesheet_periods';
UPDATE notifications SET source_table = 'project_timesheets' WHERE source_table = 'timesheet_periods';
UPDATE work_time_balance_entries SET source_table = 'project_timesheets' WHERE source_table = 'timesheet_periods';
UPDATE versions SET source_table = 'project_timesheets' WHERE source_table = 'timesheet_periods';
