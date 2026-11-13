--liquibase formatted sql

-- Departments and a person's employment over time.
-- - departments: an organization's own list (Administration, HR, Sales, ...), each with a default
--   leader. The leader is only a default: a person's manager is whoever their assignment names.
-- - employee_assignments: from `valid_from` on, a person belongs to a department with a function
--   and reports to a manager. The row in force on a day (latest valid_from <= that day) answers
--   "who is X's manager", so a manager change is dated and its history kept.
-- - organization_memberships.start_date: the employment start (joined_at is when the account
--   joined the organization); manager_user_id moves into the assignments and is dropped.

--changeset worktime:050-departments
CREATE TABLE departments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT     NOT NULL,
    leader_user_id   UUID     REFERENCES users(id) ON DELETE SET NULL,
    is_active        BOOLEAN  NOT NULL DEFAULT TRUE,
    sort_order       INTEGER  NOT NULL DEFAULT 0,
    CONSTRAINT chk_departments_name CHECK (length(btrim(name)) > 0),
    CONSTRAINT uq_departments_name UNIQUE (organization_id, name)
);

--changeset worktime:050-employee-assignments
CREATE TABLE employee_assignments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    valid_from       DATE  NOT NULL,
    department_id    UUID  REFERENCES departments(id) ON DELETE RESTRICT,
    job_function     TEXT,
    manager_user_id  UUID  REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_employee_assignments_manager CHECK (manager_user_id IS NULL OR manager_user_id <> user_id),
    CONSTRAINT uq_employee_assignments UNIQUE (organization_id, user_id, valid_from)
);
CREATE INDEX idx_employee_assignments_manager ON employee_assignments (organization_id, manager_user_id);

--changeset worktime:050-membership-start-date
ALTER TABLE organization_memberships ADD COLUMN start_date DATE;
UPDATE organization_memberships SET start_date = joined_at::date WHERE joined_at IS NOT NULL;

--changeset worktime:050-manager-to-assignments
-- Each current manager becomes the person's first assignment, from their start date.
INSERT INTO employee_assignments (organization_id, user_id, valid_from, manager_user_id)
SELECT organization_id, user_id, COALESCE(start_date, CURRENT_DATE), manager_user_id
FROM organization_memberships
WHERE manager_user_id IS NOT NULL AND manager_user_id <> user_id
ON CONFLICT DO NOTHING;
ALTER TABLE organization_memberships DROP COLUMN manager_user_id;
