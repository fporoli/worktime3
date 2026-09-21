--liquibase formatted sql

-- Project names are unique per organization and subproject names unique per project
-- (matches how the UI and seeds address them).
-- Fails loudly if an existing database already holds duplicates — rename them first.

--changeset worktime:065-projects-unique-org-name
ALTER TABLE projects ADD CONSTRAINT uq_projects_org_name UNIQUE (organization_id, name);

--changeset worktime:066-subprojects-unique-project-name
ALTER TABLE subprojects ADD CONSTRAINT uq_subprojects_project_name UNIQUE (project_id, name);
