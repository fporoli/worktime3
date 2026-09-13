--liquibase formatted sql

-- Add missing index on (organization_id, start_time) to optimize work_times queries by organization and date range.

--changeset worktime:039-index-worktimes-org-start
CREATE INDEX IF NOT EXISTS idx_worktimes_org_start ON work_times(organization_id, start_time);
