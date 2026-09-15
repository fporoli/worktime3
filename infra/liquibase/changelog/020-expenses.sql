--liquibase formatted sql

-- Expenses: employees log ad hoc expense line items and bundle a self-chosen subset
-- into an expense_report for approval — unlike timesheet_periods (an implicit date-range
-- envelope), a report here is explicit, so expense_report_items links specific expenses
-- to specific reports. category/sub_category/billing_type are free-text, static_data-backed
-- picklists (like work_times/billability), not DB enums or FKs.

--changeset worktime:042-expenses
CREATE TABLE expenses (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id         UUID REFERENCES projects(id) ON DELETE SET NULL,
    subproject_id      UUID REFERENCES subprojects(id) ON DELETE SET NULL,
    expense_date       DATE NOT NULL,
    category           VARCHAR(128) NOT NULL,
    sub_category       VARCHAR(128),
    billing_type       VARCHAR(128),
    original_value     NUMERIC(12,2) NOT NULL,
    original_currency  CHAR(3) NOT NULL,
    currency           CHAR(3) NOT NULL,
    quantity           NUMERIC(10,2),
    comment            TEXT,
    CONSTRAINT chk_expenses_original_value_positive CHECK (original_value > 0),
    CONSTRAINT chk_expenses_quantity_non_negative CHECK (quantity IS NULL OR quantity >= 0),
    CONSTRAINT chk_expenses_original_currency_format CHECK (original_currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_expenses_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX idx_expenses_user_date ON expenses(user_id, expense_date);
CREATE INDEX idx_expenses_org_date ON expenses(organization_id, expense_date);
CREATE INDEX idx_expenses_project ON expenses(project_id);

COMMENT ON TABLE expenses IS 'One expense line item an employee logged. category/sub_category/billing_type are static_data-backed keys (entity=''expenses''), validated at the app layer only — same non-DB-enforced pattern as work_times/billability. original_value/original_currency are exactly what the receipt says; currency is the org''s fixed reporting currency for display only — no FX conversion.';

--changeset worktime:043-expense-reports
CREATE TABLE expense_reports (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'in_preparation',
    date_submitted       TIMESTAMPTZ,
    reviewed_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at          TIMESTAMPTZ,
    review_note          TEXT,
    -- Finance-pipeline trail (stage-advance events, notes) — JSONB, not more columns,
    -- same trade-off already made for workflows.workflow_data.
    data                 JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT chk_expense_reports_status CHECK (status IN (
        'in_preparation', 'submitted', 'approved', 'rejected',
        'submitted_processing', 'processing_finished', 'request_payment', 'finished'
    ))
);

CREATE INDEX idx_expense_reports_org_status ON expense_reports(organization_id, status);
CREATE INDEX idx_expense_reports_user ON expense_reports(user_id, date_submitted);

COMMENT ON TABLE expense_reports IS 'A user-curated bundle of expenses submitted for manager approval, then (once approved) walked forward through billing_admin finance stages. status is plain TEXT + CHECK, not a Postgres enum, so the still-evolving finance-stage list stays a cheap DROP/ADD CONSTRAINT away from changing. Locking (no edits to mapped expenses once submitted) is enforced in application code, not a DB trigger — same convention as timesheet_periods.';

--changeset worktime:044-expense-report-items
CREATE TABLE expense_report_items (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
    expense_id        UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    -- Denormalized from expenses/expense_reports (which must already agree) purely so
    -- org-scoped queries/access checks on this table don't need a join — same convenience
    -- already taken on work_times/timesheet_periods, which both carry their own organization_id.
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT uq_expense_report_items_expense UNIQUE (expense_id)
);

CREATE INDEX idx_expense_report_items_report ON expense_report_items(expense_report_id);
CREATE INDEX idx_expense_report_items_org ON expense_report_items(organization_id);

COMMENT ON TABLE expense_report_items IS 'Explicit expense<->expense_report mapping (not an implicit date-range membership like timesheet_periods): a report is whichever specific expenses its owner chose to attach. UNIQUE(expense_id) means an expense belongs to at most one report at a time, but may be detached and reattached elsewhere (e.g. after rejection).';
