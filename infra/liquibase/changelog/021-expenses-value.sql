--liquibase formatted sql

-- `value` is the manually-entered amount in the org's reporting currency (`currency`) —
-- original_value/original_currency stays exactly what the receipt says; this is the employee's
-- (or finance's) converted figure, entered by hand rather than computed from any FX rate/API.
-- Defaults to 0 so it's always present even before anyone has filled it in.

--changeset worktime:045-expenses-value
ALTER TABLE expenses
    ADD COLUMN value NUMERIC(12,2) NOT NULL DEFAULT 0;
