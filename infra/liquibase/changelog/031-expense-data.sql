--liquibase formatted sql

-- Custom fields on the expense form (docs/FIELD_CONFIG.md): values of fields that a global
-- or org template defines are stored here by key. Expense rows belong to one organization,
-- so unlike users.basicdata there is no per-org section.

--changeset worktime:066-expense-data
ALTER TABLE expenses ADD COLUMN data JSONB NOT NULL DEFAULT '{}';
