--liquibase formatted sql

-- Nothing reads organizations.created_by_user_id: ownership/authority comes from
-- organization_memberships.role_ids, and the audit log records who created what.
-- Same for work_time_balance_entries.created_by_user_id, which was write-only.

--changeset worktime:063-drop-organizations-created-by
ALTER TABLE organizations DROP COLUMN created_by_user_id;

--changeset worktime:064-drop-work-time-balance-entries-created-by
ALTER TABLE work_time_balance_entries DROP COLUMN created_by_user_id;
