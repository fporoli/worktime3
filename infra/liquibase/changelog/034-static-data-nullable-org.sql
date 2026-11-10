--liquibase formatted sql

--changeset worktime:034-static-data-nullable-org splitStatements:false
-- Allow organization_id IS NULL in static_data so global (all-organization) enums can be defined
-- alongside org-specific overrides, enforce uniqueness across NULL via sentinel COALESCE, and move
-- un-customized users locales/nations/countries to global rows.
ALTER TABLE static_data ALTER COLUMN organization_id DROP NOT NULL;

DROP INDEX IF EXISTS uq_static_data_org_entity_enum;
CREATE UNIQUE INDEX uq_static_data_org_entity_enum ON static_data (
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
  entity,
  enum_name
);

CREATE INDEX IF NOT EXISTS idx_static_data_global_entity
  ON static_data (entity, enum_name)
  WHERE organization_id IS NULL;

INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES
  (NULL, 'users', 'locales', $wtjson${"de":"Deutsch","fr":"Français","it":"Italiano","rm":"Rumantsch","en":"English","es":"Spanish","pt":"Portuguese","cs":"Czech","sk":"Slovak","pl":"Polish","other":"Others"}$wtjson$::jsonb, $wtjson${"en":{"de":"German","fr":"French","it":"Italian","rm":"Romansh","en":"English","es":"Spanish","pt":"Portuguese","cs":"Czech","sk":"Slovak","pl":"Polish","other":"Others"},"de":{"de":"Deutsch","fr":"Französisch","it":"Italienisch","rm":"Rätoromanisch","en":"Englisch","es":"Spanisch","pt":"Portugiesisch","cs":"Tschechisch","sk":"Slowakisch","pl":"Polnisch","other":"Andere"},"fr":{"de":"Allemand","fr":"Français","it":"Italien","rm":"Romanche","en":"Anglais","es":"Espagnol","pt":"Portugais","cs":"Tchèque","sk":"Slovaque","pl":"Polonais","other":"Autres"},"it":{"de":"Tedesco","fr":"Francese","it":"Italiano","rm":"Romancio","en":"Inglese","es":"Spagnolo","pt":"Portoghese","cs":"Ceco","sk":"Slovacco","pl":"Polacco","other":"Altri"}}$wtjson$::jsonb),
  (NULL, 'users', 'nations', $wtjson${"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}$wtjson$::jsonb, $wtjson${"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}$wtjson$::jsonb),
  (NULL, 'users', 'countries', $wtjson${"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}$wtjson$::jsonb, $wtjson${"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}$wtjson$::jsonb)
ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), entity, enum_name) DO UPDATE
SET
  "values" = EXCLUDED."values",
  translation = EXCLUDED.translation;

DELETE FROM static_data org_sd
USING static_data global_sd
WHERE global_sd.organization_id IS NULL
  AND global_sd.entity = 'users'
  AND global_sd.enum_name IN ('locales', 'nations', 'countries')
  AND org_sd.organization_id IS NOT NULL
  AND org_sd.entity = global_sd.entity
  AND org_sd.enum_name = global_sd.enum_name
  AND org_sd."values" = global_sd."values"
  AND org_sd.translation = global_sd.translation;
