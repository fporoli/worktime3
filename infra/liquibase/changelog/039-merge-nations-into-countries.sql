--liquibase formatted sql

-- Nationality and address country share one list: static_data users/countries.
-- The users/nations rows held the same countries and are removed. An organization that
-- customized only `nations` keeps its list, renamed to `countries`; where it has both,
-- its `countries` list wins. Stored nationality values are country codes either way.

--changeset worktime:039-merge-nations-into-countries
UPDATE static_data n
SET enum_name = 'countries'
WHERE n.entity = 'users'
  AND n.enum_name = 'nations'
  AND n.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM static_data c
    WHERE c.entity = 'users' AND c.enum_name = 'countries' AND c.organization_id = n.organization_id
  );

DELETE FROM static_data WHERE entity = 'users' AND enum_name = 'nations';
