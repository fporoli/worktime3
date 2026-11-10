--liquibase formatted sql

--changeset worktime:033-basicdata-restrict-languages-countries splitStatements:false
-- Restrict users locales, nations, and countries to Switzerland, Swiss neighbours (DE, FR, IT, AT, LI),
-- ES, PT, GB (UK), US, CZ, SK, PL (PO), and Others, keeping any existing custom labels for kept keys.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT
  o.id,
  'users',
  v.enum_name,
  v.default_values,
  v.default_translation
FROM organizations o
CROSS JOIN (
  VALUES
    ('locales', $wtjson${"de":"Deutsch","fr":"Français","it":"Italiano","rm":"Rumantsch","en":"English","es":"Spanish","pt":"Portuguese","cs":"Czech","sk":"Slovak","pl":"Polish","other":"Others"}$wtjson$::jsonb, $wtjson${"en":{"de":"German","fr":"French","it":"Italian","rm":"Romansh","en":"English","es":"Spanish","pt":"Portuguese","cs":"Czech","sk":"Slovak","pl":"Polish","other":"Others"},"de":{"de":"Deutsch","fr":"Französisch","it":"Italienisch","rm":"Rätoromanisch","en":"Englisch","es":"Spanisch","pt":"Portugiesisch","cs":"Tschechisch","sk":"Slowakisch","pl":"Polnisch","other":"Andere"},"fr":{"de":"Allemand","fr":"Français","it":"Italien","rm":"Romanche","en":"Anglais","es":"Espagnol","pt":"Portugais","cs":"Tchèque","sk":"Slovaque","pl":"Polonais","other":"Autres"},"it":{"de":"Tedesco","fr":"Francese","it":"Italiano","rm":"Romancio","en":"Inglese","es":"Spagnolo","pt":"Portoghese","cs":"Ceco","sk":"Slovacco","pl":"Polacco","other":"Altri"}}$wtjson$::jsonb),
    ('nations', $wtjson${"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}$wtjson$::jsonb, $wtjson${"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}$wtjson$::jsonb),
    ('countries', $wtjson${"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}$wtjson$::jsonb, $wtjson${"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}$wtjson$::jsonb)
) AS v(enum_name, default_values, default_translation)
ON CONFLICT (organization_id, entity, enum_name) DO UPDATE
SET
  "values" = (
    SELECT jsonb_object_agg(e.key, COALESCE(static_data."values"->e.key, e.value))
    FROM jsonb_each(EXCLUDED."values") AS e(key, value)
  ),
  translation = jsonb_build_object(
    'en', (
      SELECT jsonb_object_agg(e.key, COALESCE(static_data.translation->'en'->e.key, e.value))
      FROM jsonb_each(EXCLUDED.translation->'en') AS e(key, value)
    ),
    'de', (
      SELECT jsonb_object_agg(e.key, COALESCE(static_data.translation->'de'->e.key, e.value))
      FROM jsonb_each(EXCLUDED.translation->'de') AS e(key, value)
    ),
    'fr', (
      SELECT jsonb_object_agg(e.key, COALESCE(static_data.translation->'fr'->e.key, e.value))
      FROM jsonb_each(EXCLUDED.translation->'fr') AS e(key, value)
    ),
    'it', (
      SELECT jsonb_object_agg(e.key, COALESCE(static_data.translation->'it'->e.key, e.value))
      FROM jsonb_each(EXCLUDED.translation->'it') AS e(key, value)
    )
  );
