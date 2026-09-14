--liquibase formatted sql

-- Reverting 018: this workflow only ever needs one step in flight per run,
-- so the extra workflow_steps table was more indirection than the feature
-- (an employee's "reopen my approved month" request) needs — everything
-- (assignment, current step, the requester's text) goes back on workflows
-- itself, one row per request.

--changeset worktime:041-revert-workflow-steps
DROP TABLE workflow_steps;

ALTER TABLE workflows
    ADD COLUMN step TEXT,
    ADD COLUMN step_status TEXT,
    ADD COLUMN workflow_step_started TIMESTAMPTZ,
    ADD COLUMN workflow_step_finished TIMESTAMPTZ,
    ADD COLUMN workflow_step_to_be_finished_until TIMESTAMPTZ,
    ADD COLUMN assigned_to_user_id UUID[],
    ADD COLUMN assigned_to_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    ADD COLUMN notification JSONB NOT NULL DEFAULT '{}';

CREATE INDEX idx_workflows_team ON workflows(assigned_to_team_id);
ALTER TABLE workflows ADD CONSTRAINT chk_workflows_assignee_required CHECK (assigned_to_user_id IS NOT NULL OR assigned_to_team_id IS NOT NULL);
