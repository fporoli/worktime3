--liquibase formatted sql

-- Cost rates removed: not needed for this deployment. Cost reporting
-- (TeamHours "Show cost", the assistant's project-cost tool) is removed
-- from the application in the same change.

--changeset worktime:021-drop-member-rates
DROP TABLE IF EXISTS member_rates;

-- Every work_time is created through an org-scoped route (or the
-- assistant, which is also org-scoped) — organization_id is never
-- actually left blank in practice, project or not, since a project always
-- carries its own organization_id anyway. Making the column NOT NULL just
-- states that guarantee at the schema level instead of leaving it optional.

--changeset worktime:022-worktime-organization-required
ALTER TABLE work_times ALTER COLUMN organization_id SET NOT NULL;
