--liquibase formatted sql

-- Absence types can skip the manager's approval: in the absences/absence_type static_data row,
-- each type maps to an attribute object, and {"approval": false} means an absence of that type is
-- approved on submit (the manager is notified instead of asked). Sickness and accident default to it.

--changeset worktime:047-absence-approval-flag-orgs
-- Existing org rows: flag sickness and accident where the type still has no attributes, so an
-- org's own choices are left alone.
UPDATE static_data
SET "values" = "values"
  || CASE WHEN "values"->'sickness' = '{}'::jsonb THEN '{"sickness": {"approval": false}}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN "values"->'accident' = '{}'::jsonb THEN '{"accident": {"approval": false}}'::jsonb ELSE '{}'::jsonb END
WHERE entity = 'absences' AND enum_name = 'absence_type'
  AND ("values"->'sickness' = '{}'::jsonb OR "values"->'accident' = '{}'::jsonb);

--changeset worktime:047-absence-approval-flag-global
-- Global default row, used by every org without its own copy. The code has no built-in list:
-- absence types, their attributes and labels come only from static_data.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'absences', 'absence_type',
  '{"vacation":{},"military_service":{},"accident":{"approval":false},"compensation":{},"school":{},"sickness":{"approval":false},"other":{}}'::jsonb,
  '{"en":{"vacation":"Vacation","military_service":"Military service","accident":"Accident","compensation":"Compensation","school":"School / education","sickness":"Sickness","other":"Other"},
    "de":{"vacation":"Ferien","military_service":"Militärdienst","accident":"Unfall","compensation":"Kompensation","school":"Schule / Ausbildung","sickness":"Krankheit","other":"Sonstiges"},
    "fr":{"vacation":"Vacances","military_service":"Service militaire","accident":"Accident","compensation":"Compensation","school":"École / formation","sickness":"Maladie","other":"Autre"},
    "it":{"vacation":"Vacanza","military_service":"Servizio militare","accident":"Infortunio","compensation":"Compensazione","school":"Scuola / formazione","sickness":"Malattia","other":"Altro"}}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'absences' AND enum_name = 'absence_type'
);
