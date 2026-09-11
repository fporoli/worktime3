--liquibase formatted sql

-- A team's manager, distinct from team_members.manager_user_id (which is
-- per-member and can vary within a team). Onboarding/offboarding team
-- members is restricted to this person (plus org admins) — see
-- TeamsController#addMember/#removeMember.

--changeset worktime:028-team-lead
ALTER TABLE teams ADD COLUMN lead_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
