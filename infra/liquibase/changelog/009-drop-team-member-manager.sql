--liquibase formatted sql

-- team_members.manager_user_id was a per-member "who manages this person"
-- field, separate from (and redundant with) the team's own lead — see
-- teams.lead_user_id (008-team-lead.sql). Dropping it in favor of that
-- single team-level lead.

--changeset worktime:029-drop-team-member-manager
ALTER TABLE team_members DROP COLUMN manager_user_id;
