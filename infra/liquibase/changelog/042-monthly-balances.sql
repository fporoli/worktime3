--liquibase formatted sql

-- Monthly balances (apps/api/src/balances.service.ts). A month is closed when its working-time
-- timesheet is approved: the row freezes target, attendance and vacation for that month, and is
-- removed again when the timesheet is reopened. Open months are computed live from the work-time
-- model. Balances are derived, not stored: overtime = closed months' deltas (plus the live months)
-- + adjustments; vacation = entitlement per year - vacation taken + adjustments, carried over.
-- Replaces work_time_balance_entries / work_time_balances, which stay for now but are no longer written.

--changeset worktime:042-work-time-months
CREATE TABLE work_time_months (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id              UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- First day of the month.
    month                DATE         NOT NULL,
    timesheet_period_id  UUID         REFERENCES timesheet_periods(id) ON DELETE SET NULL,
    scheduled_minutes    INTEGER      NOT NULL DEFAULT 0,
    holiday_minutes      INTEGER      NOT NULL DEFAULT 0,
    -- Minutes credited per absence type, e.g. {"vacation": 960, "sick": 480}.
    absence_minutes      JSONB        NOT NULL DEFAULT '{}',
    target_minutes       INTEGER      NOT NULL,
    actual_minutes       INTEGER      NOT NULL,
    delta_minutes        INTEGER      NOT NULL,
    -- Vacation taken in the month, in full-time days.
    vacation_days        NUMERIC(6,2) NOT NULL DEFAULT 0,
    closed_by_user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
    closed_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_work_time_months_first CHECK (EXTRACT(DAY FROM month) = 1),
    CONSTRAINT uq_work_time_months UNIQUE (organization_id, user_id, month)
);

--changeset worktime:042-balance-adjustments
-- Manual bookings on a balance: an opening balance when someone starts using the app, a
-- correction, or a payout. Amount in minutes for overtime, in full-time days for vacation.
CREATE TABLE balance_adjustments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance             TEXT          NOT NULL,
    kind                TEXT          NOT NULL,
    effective_date      DATE          NOT NULL,
    amount              NUMERIC(10,2) NOT NULL,
    note                TEXT,
    created_by_user_id  UUID          REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_balance_adjustments_balance CHECK (balance IN ('overtime', 'vacation')),
    CONSTRAINT chk_balance_adjustments_kind CHECK (kind IN ('opening', 'correction', 'payout'))
);
CREATE INDEX idx_balance_adjustments_user ON balance_adjustments (organization_id, user_id, effective_date);

--changeset worktime:042-vacation-entitlements
-- A person's vacation days for a year when they differ from the organization's default
-- (settings.vacationDaysPerYear, prorated by workload and membership).
CREATE TABLE vacation_entitlements (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year             INTEGER      NOT NULL,
    days             NUMERIC(6,2) NOT NULL,
    note             TEXT,
    CONSTRAINT chk_vacation_entitlements_year CHECK (year BETWEEN 2000 AND 2100),
    CONSTRAINT chk_vacation_entitlements_days CHECK (days >= 0 AND days <= 366),
    CONSTRAINT uq_vacation_entitlements UNIQUE (organization_id, user_id, year)
);

--changeset worktime:042-migrate-balance-ledger
-- Approved timesheets keep the numbers they were approved with: the latest ledger entry of each
-- approved period becomes its closed month. Manual overtime entries become corrections. Vacation
-- debits are now derived from approved absences; manual vacation entries (minutes) become
-- corrections in full-time days.
INSERT INTO work_time_months (organization_id, user_id, month, timesheet_period_id, target_minutes, actual_minutes, delta_minutes, closed_by_user_id, closed_at)
SELECT p.organization_id, p.user_id, p.period_start, p.id,
       ROUND(COALESCE(e.target_minutes, 0)), ROUND(COALESCE(e.actual_minutes, 0)), ROUND(e.delta_minutes),
       e.created_by_user_id, e.created_at
FROM timesheet_periods p
JOIN LATERAL (
    SELECT * FROM work_time_balance_entries x
    WHERE x.source_table = 'timesheet_periods' AND x.source_table_uuid = p.id AND x.balance_type = 'overtime'
    ORDER BY x.created_at DESC
    LIMIT 1
) e ON TRUE
WHERE p.status = 'approved' AND e.target_minutes IS NOT NULL
ON CONFLICT (organization_id, user_id, month) DO NOTHING;

INSERT INTO balance_adjustments (organization_id, user_id, balance, kind, effective_date, amount, note, created_by_user_id)
SELECT e.organization_id, e.user_id, 'overtime', 'correction', e.created_at::date, e.delta_minutes, e.note, e.created_by_user_id
FROM work_time_balance_entries e
WHERE e.source_table IS NULL AND e.balance_type = 'overtime';

INSERT INTO balance_adjustments (organization_id, user_id, balance, kind, effective_date, amount, note, created_by_user_id)
SELECT e.organization_id, e.user_id, 'vacation', 'correction', e.created_at::date,
       ROUND(e.delta_minutes / (COALESCE((o.settings->>'fullTimeWeeklyMinutes')::numeric, 2400) / 5), 2),
       COALESCE(e.note, 'migrated from minutes'), e.created_by_user_id
FROM work_time_balance_entries e
JOIN organizations o ON o.id = e.organization_id
WHERE e.source_table IS NULL AND e.balance_type = 'vacation';

--changeset worktime:042-drop-max-hours-per-day
-- Vacation is now counted from the work schedule, not a fixed number of hours per day.
UPDATE organizations SET settings = settings - 'maxHoursPerDay' WHERE jsonb_exists(settings, 'maxHoursPerDay');
