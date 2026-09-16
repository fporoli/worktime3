--liquibase formatted sql

-- original_value/original_currency were mandatory ("exactly what the receipt says"), but the UI
-- now tucks them into a collapsible "Additional data" section and not every expense has a
-- separate receipt currency/amount worth recording — make both optional. The format/positive
-- checks still apply whenever a value is actually given.

--changeset worktime:047-expenses-original-nullable
ALTER TABLE expenses ALTER COLUMN original_value DROP NOT NULL;
ALTER TABLE expenses ALTER COLUMN original_currency DROP NOT NULL;

ALTER TABLE expenses DROP CONSTRAINT chk_expenses_original_value_positive;
ALTER TABLE expenses ADD CONSTRAINT chk_expenses_original_value_positive
    CHECK (original_value IS NULL OR original_value > 0);

ALTER TABLE expenses DROP CONSTRAINT chk_expenses_original_currency_format;
ALTER TABLE expenses ADD CONSTRAINT chk_expenses_original_currency_format
    CHECK (original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$');
