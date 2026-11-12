--liquibase formatted sql

-- Project timesheet (apps/api/src/project-timesheets.controller.ts): an employee submits a
-- month's project time, and each project's hours go to that project's owner for approval,
-- separately from the working-time timesheet (timesheet_periods), which goes to the line
-- manager and feeds the balances. One row per person, project and month; a submitted or
-- approved row locks that person's project time on that project in that month.

--changeset worktime:044-project-time-periods
CREATE TABLE project_time_periods (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID              NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id              UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id           UUID              NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    period_start         DATE              NOT NULL,
    period_end           DATE              NOT NULL,
    status               timesheet_status  NOT NULL DEFAULT 'open',
    submitted_at         TIMESTAMPTZ,
    reviewed_by_user_id  UUID              REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at          TIMESTAMPTZ,
    review_note          TEXT,
    CONSTRAINT chk_project_time_periods_range CHECK (period_end > period_start),
    CONSTRAINT uq_project_time_periods UNIQUE (organization_id, user_id, project_id, period_start)
);
CREATE INDEX idx_project_time_periods_project ON project_time_periods (project_id, period_start);
