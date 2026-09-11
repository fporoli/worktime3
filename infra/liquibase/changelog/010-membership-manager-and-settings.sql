--liquibase formatted sql

-- The default manager a person's timesheet approval requests route to.
-- NULL means this member is the top of their chain (e.g. an org owner) and
-- doesn't need their own timesheets approved by anyone.

--changeset worktime:030-membership-manager
ALTER TABLE organization_memberships ADD COLUMN manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Free-form per-membership bucket for things that don't warrant their own
-- columns yet — validity date ranges, planned holidays, and similar.

--changeset worktime:031-membership-settings
ALTER TABLE organization_memberships ADD COLUMN settings JSONB NOT NULL DEFAULT '{}';
