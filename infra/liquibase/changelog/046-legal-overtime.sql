--liquibase formatted sql

-- Überzeit (legal overtime, Swiss ArG art. 12/13): attendance beyond the legal weekly maximum
-- (organizations.settings.legalMaxWeeklyMinutes, 45 h by default). It is part of the overtime
-- balance, kept as its own account so it can be reported against the yearly limit and paid out.
--
-- work_time_months.legal_overtime_minutes freezes a closed month's share; NULL (months closed
-- before this change) means "compute it from attendance". balance_adjustments gain the account
-- 'legal_overtime' (e.g. a payout of Überzeit).

--changeset worktime:046-legal-overtime-month
ALTER TABLE work_time_months ADD COLUMN legal_overtime_minutes integer;

--changeset worktime:046-legal-overtime-adjustments
ALTER TABLE balance_adjustments DROP CONSTRAINT chk_balance_adjustments_balance;
ALTER TABLE balance_adjustments ADD CONSTRAINT chk_balance_adjustments_balance CHECK (balance IN ('overtime', 'vacation', 'legal_overtime'));
