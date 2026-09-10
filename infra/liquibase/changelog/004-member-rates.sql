--liquibase formatted sql

-- Hourly cost rate per person, effective-dated so historical cost reports
-- use the rate that was active when the work happened, not today's rate.
-- The write path (rates.controller.ts) closes the previous open rate's
-- effective_to itself when a new one starts — no DB-level overlap
-- constraint (would need btree_gist for a real exclusion constraint).

--changeset worktime:020-member-rates
CREATE TABLE member_rates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hourly_rate      NUMERIC(10,2) NOT NULL,
    currency         VARCHAR(3) NOT NULL DEFAULT 'USD',
    effective_from   DATE NOT NULL,
    effective_to     DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_member_rate_positive CHECK (hourly_rate >= 0),
    CONSTRAINT chk_member_rate_order CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX idx_member_rates_lookup ON member_rates(organization_id, user_id, effective_from);

COMMENT ON TABLE member_rates IS 'Effective-dated hourly cost rate per person, for project/team cost reports. Admin-managed (compensation data).';
