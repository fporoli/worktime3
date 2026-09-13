--liquibase formatted sql

-- last_modified_by_workflow_uuid -> lastmodified_by_workflow_id: matches
-- lastmodified/lastmodified_by_user_id's spelling, and the _id suffix now
-- despite there being no workflows table (and thus no FK) yet.

--changeset worktime:035-versions-rename-workflow-column
ALTER TABLE versions RENAME COLUMN last_modified_by_workflow_uuid TO lastmodified_by_workflow_id;
