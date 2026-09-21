--liquibase formatted sql

-- When an employee leaves the organization, alongside `joined_at`.

--changeset worktime:062-membership-exit-at
ALTER TABLE organization_memberships ADD COLUMN exit_at TIMESTAMPTZ;
ALTER TABLE organization_memberships ADD CONSTRAINT chk_membership_exit_after_joined
  CHECK (exit_at IS NULL OR joined_at IS NULL OR exit_at > joined_at);
