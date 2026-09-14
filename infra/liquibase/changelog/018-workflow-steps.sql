--liquibase formatted sql

-- workflows previously crammed "the run" and "its one current step" into a
-- single row — which can't represent a multi-step workflow's history (a
-- second step would overwrite the first step's timing/assignee/status in
-- place). Split into workflows (the run: which definition, which record,
-- overall start/finish) and workflow_steps (one row per step instance,
-- keeping every step of the run's history). No data exists yet, so this is
-- a straight column move, not a backfill.
--
-- Reverted by 019-revert-workflow-steps.sql — kept here rather than deleted
-- so this database's already-recorded changeset history stays replayable
-- from scratch on a fresh environment.

--changeset worktime:040-workflow-steps
CREATE TABLE workflow_steps (
    workflow_step_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id                UUID NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    step                        TEXT NOT NULL,
    step_status                 TEXT NOT NULL DEFAULT 'pending',
    step_data                   JSONB NOT NULL DEFAULT '{}',
    step_started                TIMESTAMPTZ,
    step_finished                TIMESTAMPTZ,
    step_to_be_finished_until    TIMESTAMPTZ,
    -- Plain array, no FK — same trade-off already made elsewhere (workflows.assigned_to_user_id, roles.admin_user_ids).
    assigned_to_user_id         UUID[],
    assigned_to_team_id         UUID REFERENCES teams(id) ON DELETE SET NULL,
    notification                JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT chk_workflow_steps_assignee_required CHECK (assigned_to_user_id IS NOT NULL OR assigned_to_team_id IS NOT NULL)
);

CREATE INDEX idx_workflow_steps_workflow ON workflow_steps(workflow_id);
CREATE INDEX idx_workflow_steps_team ON workflow_steps(assigned_to_team_id);
CREATE INDEX idx_workflow_steps_assignees ON workflow_steps USING GIN (assigned_to_user_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(step_status);

ALTER TABLE workflows DROP CONSTRAINT chk_workflows_assignee_required;
DROP INDEX IF EXISTS idx_workflows_team;
ALTER TABLE workflows
    DROP COLUMN step,
    DROP COLUMN step_status,
    DROP COLUMN workflow_step_started,
    DROP COLUMN workflow_step_finished,
    DROP COLUMN workflow_step_to_be_finished_until,
    DROP COLUMN assigned_to_user_id,
    DROP COLUMN assigned_to_team_id,
    DROP COLUMN notification;
