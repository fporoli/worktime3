--liquibase formatted sql

-- Attendance clock (check-in/check-out), vacation requests, and the balance ledger
-- they feed into. Distinct from project_times: this table tracks whether someone
-- was at work at all, not what they worked on. See docs/DATABASE_SCHEMA.md.

--changeset worktime:050-work-times
CREATE TABLE work_times (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    check_in         TIMESTAMPTZ NOT NULL,
    check_out        TIMESTAMPTZ,
    comment          TEXT
);
CREATE INDEX idx_work_times_org_check_in ON work_times(organization_id, check_in);
CREATE INDEX idx_work_times_user_check_in ON work_times(user_id, check_in);
ALTER TABLE work_times ADD CONSTRAINT chk_work_time_order CHECK (check_out IS NULL OR check_out > check_in);
-- One open session per person, globally (not per-org) — you can't physically be clocked in twice.
CREATE UNIQUE INDEX uq_work_times_one_open_session ON work_times(user_id) WHERE check_out IS NULL;

--changeset worktime:051-absences
CREATE TYPE absence_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TABLE absences (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date_start           DATE NOT NULL,
    date_end             DATE NOT NULL,
    status               absence_status NOT NULL DEFAULT 'pending',
    reviewed_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at          TIMESTAMPTZ,
    review_note          TEXT,
    note                 TEXT,
    CONSTRAINT chk_absence_order CHECK (date_end >= date_start)
);
CREATE INDEX idx_absences_org_status ON absences(organization_id, status);
CREATE INDEX idx_absences_user ON absences(user_id, date_start);

--changeset worktime:052-work-time-balances
CREATE TABLE work_time_balances (
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    overtime_minutes  NUMERIC(10,2) NOT NULL DEFAULT 0,
    vacation_minutes  NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id)
);

--changeset worktime:053-work-time-balance-entries
CREATE TYPE balance_entry_type AS ENUM ('overtime', 'vacation');
CREATE TABLE work_time_balance_entries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance_type        balance_entry_type NOT NULL,
    source_table        TEXT,
    source_table_uuid   UUID,
    target_minutes      NUMERIC(10,2),
    actual_minutes      NUMERIC(10,2),
    delta_minutes       NUMERIC(10,2) NOT NULL,
    note                TEXT,
    created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_work_time_balance_entries_org_user ON work_time_balance_entries(organization_id, user_id, created_at);
