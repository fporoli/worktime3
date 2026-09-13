--liquibase formatted sql

-- Renaming right after 012 (no data, nothing references this table yet), as
-- a new changeset rather than editing 012 in place — 012 already ran, and
-- Liquibase checksums a changeset's SQL once applied.
--
-- "table" -> source_table / table_uuid -> source_table_uuid: makes explicit
-- that this points at a record in some *other* table (still no FK — it's
-- polymorphic), and drops the need to quote the reserved word "table".
-- version_uuid / created_by_user_uuid / lastmodified_by_user_uuid -> *_id:
-- these are either this row's own real primary key or an enforced FK to
-- users, so they get this schema's normal _id suffix. last_modified_by_
-- workflow_uuid keeps its _uuid suffix — no workflows table exists yet, so
-- it stays an unenforced raw UUID like source_table_uuid.

--changeset worktime:034-versions-rename-columns
ALTER TABLE versions RENAME COLUMN "table" TO source_table;
ALTER TABLE versions RENAME COLUMN table_uuid TO source_table_uuid;
ALTER TABLE versions RENAME COLUMN version_uuid TO version_id;
ALTER TABLE versions RENAME COLUMN created_by_user_uuid TO created_by_user_id;
ALTER TABLE versions RENAME COLUMN lastmodified_by_user_uuid TO lastmodified_by_user_id;

ALTER INDEX uq_versions_table_record RENAME TO uq_versions_source_table_record;
ALTER TABLE versions RENAME CONSTRAINT versions_created_by_user_uuid_fkey TO versions_created_by_user_id_fkey;
ALTER TABLE versions RENAME CONSTRAINT versions_lastmodified_by_user_uuid_fkey TO versions_lastmodified_by_user_id_fkey;
