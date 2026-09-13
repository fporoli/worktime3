--liquibase formatted sql

-- Table names follow this schema's snake_case-plural convention
-- (workflow_definitions / workflows), not the PascalCase given in the spec.

--changeset worktime:036-workflow-definitions
CREATE TABLE workflow_definitions (
    workflow_def_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    description      TEXT,
    -- Ordered array of step definitions (name, assignment rules, SLA, etc.) — shape owned by the app, not enforced here.
    steps            JSONB NOT NULL DEFAULT '[]',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_definitions_org ON workflow_definitions(organization_id);

-- A running (or finished) instance of a workflow_definition against one record elsewhere in the
-- schema (source_table/source_table_uuid — polymorphic, same pattern as versions; no FK, see there).
-- Tracks both the overall workflow's lifecycle and its *current* step's lifecycle side by side.

--changeset worktime:037-workflows
CREATE TABLE workflows (
    workflow_id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_def_id                      UUID NOT NULL REFERENCES workflow_definitions(workflow_def_id) ON DELETE CASCADE,
    source_table                         TEXT NOT NULL,
    source_table_uuid                    UUID NOT NULL,
    step                                 TEXT NOT NULL,
    step_status                          TEXT NOT NULL,
    workflow_data                        JSONB NOT NULL DEFAULT '{}',
    workflow_started                     TIMESTAMPTZ,
    workflow_finished                    TIMESTAMPTZ,
    workflow_to_be_finished_until        TIMESTAMPTZ,
    workflow_step_started                TIMESTAMPTZ,
    workflow_step_finished                 TIMESTAMPTZ,
    workflow_step_to_be_finished_until    TIMESTAMPTZ,
    -- Plain array, no FK — same trade-off already made for roles.admin_user_ids etc.
    assigned_to_user_id                  UUID[],
    assigned_to_team_id                  UUID REFERENCES teams(id) ON DELETE SET NULL,
    notification                         JSONB NOT NULL DEFAULT '{}',
    created_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_workflows_assignee_required CHECK (assigned_to_user_id IS NOT NULL OR assigned_to_team_id IS NOT NULL)
);

CREATE INDEX idx_workflows_def ON workflows(workflow_def_id);
CREATE INDEX idx_workflows_source ON workflows(source_table, source_table_uuid);
CREATE INDEX idx_workflows_team ON workflows(assigned_to_team_id);
