--liquibase formatted sql

-- Absence type (vacation/sickness/etc.), full/half day, and a generic evidence-document
-- attachment (one per absence, one per expense — e.g. a doctor's note or a pay slip).
-- See docs/DATABASE_SCHEMA.md.

--changeset worktime:054-absence-type-half-day
ALTER TABLE absences ADD COLUMN absence_type VARCHAR(64) NOT NULL DEFAULT 'vacation';
ALTER TABLE absences ADD COLUMN half_day BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE absences ADD CONSTRAINT chk_absence_half_day_single_day CHECK (NOT half_day OR date_start = date_end);

--changeset worktime:055-documents
-- Generic uploaded-file metadata, reused by any record that needs at most one evidence
-- attachment — an absence's doctor's note, an expense's pay slip, etc. — via a nullable
-- `document_id` FK on that record, rather than a table per attachment kind.
CREATE TABLE documents (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    file_name            TEXT NOT NULL,
    mime_type            TEXT NOT NULL,
    size_bytes           INTEGER NOT NULL,
    storage_path         TEXT NOT NULL,
    -- Polymorphic reverse pointer to whichever row this was uploaded for — no FK, like
    -- versions.source_table / work_time_balance_entries.source_table. Not used for access
    -- control (that goes through the owning row's own document_id FK); this is for
    -- diagnostics/cleanup queries (e.g. "every document ever attached to absence X").
    source_table         TEXT,
    source_table_id      UUID,
    uploaded_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_documents_organization ON documents(organization_id);
CREATE INDEX idx_documents_source ON documents(source_table, source_table_id);

ALTER TABLE absences ADD COLUMN document_id UUID REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

--changeset worktime:056-seed-absence-type-static-data
-- Backfill the absence_type static_data row for every existing org (new orgs get
-- this seeded at registration time instead — see auth.controller.ts register()).
INSERT INTO static_data (organization_id, entity, enum_name, values, translation)
SELECT id, 'absences', 'absence_type',
  '{"vacation":{},"military_service":{},"accident":{},"compensation":{},"school":{},"sickness":{},"other":{}}'::jsonb,
  '{"en":{"vacation":"Vacation","military_service":"Military service","accident":"Accident","compensation":"Compensation","school":"School / education","sickness":"Sickness","other":"Other"},
    "de":{"vacation":"Ferien","military_service":"Militärdienst","accident":"Unfall","compensation":"Kompensation","school":"Schule / Ausbildung","sickness":"Krankheit","other":"Sonstiges"},
    "fr":{"vacation":"Vacances","military_service":"Service militaire","accident":"Accident","compensation":"Compensation","school":"École / formation","sickness":"Maladie","other":"Autre"},
    "it":{"vacation":"Vacanza","military_service":"Servizio militare","accident":"Infortunio","compensation":"Compensazione","school":"Scuola / formazione","sickness":"Malattia","other":"Altro"}}'::jsonb
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM static_data sd WHERE sd.organization_id = o.id AND sd.entity = 'absences' AND sd.enum_name = 'absence_type'
);
