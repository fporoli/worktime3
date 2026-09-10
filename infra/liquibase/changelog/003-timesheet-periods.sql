--liquibase formatted sql

-- Monthly timesheet lock/submit/approve workflow. Kept as its own table —
-- work_times rows are never touched or flagged; "is this entry locked" is
-- purely a lookup here (locked iff a row exists for the entry's
-- org/user/month with status 'submitted' or 'approved'). See
-- access.ts::isPeriodLocked for the one place that lookup happens.

--changeset worktime:019-timesheet-periods
CREATE TYPE timesheet_status AS ENUM ('open', 'submitted', 'approved', 'rejected');

CREATE TABLE timesheet_periods (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    status              timesheet_status NOT NULL DEFAULT 'open',
    submitted_at        TIMESTAMPTZ,
    reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    review_note         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_timesheet_period UNIQUE (organization_id, user_id, period_start),
    CONSTRAINT chk_timesheet_period_order CHECK (period_end > period_start)
);

CREATE INDEX idx_timesheet_periods_org_status ON timesheet_periods(organization_id, status);
CREATE INDEX idx_timesheet_periods_user ON timesheet_periods(user_id, period_start);

COMMENT ON TABLE timesheet_periods IS 'Month-end lock: employee submits, a manager/admin approves or rejects. Locking is enforced in application code (see access.ts::isPeriodLocked), not by a DB trigger.';
