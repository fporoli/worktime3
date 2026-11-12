--liquibase formatted sql

-- Work-time model (packages/shared/src/worktime.ts): each person's work schedule with history,
-- and an organization's changes to its public-holiday calendar. The built-in Swiss holidays
-- are computed in code from the canton in organizations.settings.holidayRegion, so no holiday
-- rows are loaded per year. The full-time week and the project-time tolerance are organizations.settings
-- values too (fullTimeWeeklyMinutes, projectTimeToleranceMinutes).

--changeset worktime:040-work-schedules
-- One row per change: a schedule applies from valid_from until the next row's valid_from.
CREATE TABLE work_schedules (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id   UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    valid_from        DATE         NOT NULL,
    workload_percent  NUMERIC(5,2) NOT NULL DEFAULT 100,
    -- Target minutes per weekday, Monday .. Sunday.
    day_minutes       INTEGER[]    NOT NULL,
    CONSTRAINT chk_work_schedules_days CHECK (array_length(day_minutes, 1) = 7),
    CONSTRAINT chk_work_schedules_workload CHECK (workload_percent >= 0 AND workload_percent <= 100),
    CONSTRAINT uq_work_schedules UNIQUE (organization_id, user_id, valid_from)
);

--changeset worktime:040-org-holidays
-- An organization's own days off (observed) and canton holidays it works on (not observed).
CREATE TABLE org_holidays (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date             DATE         NOT NULL,
    name             TEXT,
    fraction         NUMERIC(3,2) NOT NULL DEFAULT 1,
    observed         BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_org_holidays_fraction CHECK (fraction > 0 AND fraction <= 1),
    CONSTRAINT uq_org_holidays UNIQUE (organization_id, date)
);

--changeset worktime:040-weekly-target-to-schedule
-- The old per-membership setting (weekly minutes, Monday-Friday) becomes the person's first
-- schedule, from the day they joined; the setting is then removed.
INSERT INTO work_schedules (organization_id, user_id, valid_from, workload_percent, day_minutes)
SELECT m.organization_id, m.user_id,
       COALESCE(m.joined_at::date, DATE '2000-01-01'),
       LEAST(100, ROUND((m.settings->>'weeklyTargetMinutes')::numeric * 100 / 2400, 2)),
       ARRAY[w, w, w, w, w, 0, 0]
FROM organization_memberships m
CROSS JOIN LATERAL (SELECT ((m.settings->>'weeklyTargetMinutes')::numeric / 5)::int AS w) d
WHERE jsonb_typeof(m.settings->'weeklyTargetMinutes') = 'number'
  AND (m.settings->>'weeklyTargetMinutes')::numeric > 0
ON CONFLICT DO NOTHING;

-- (jsonb_exists rather than the ? operator, which JDBC would read as a parameter placeholder.)
UPDATE organization_memberships SET settings = settings - 'weeklyTargetMinutes'
WHERE jsonb_exists(settings, 'weeklyTargetMinutes');
