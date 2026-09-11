--liquibase formatted sql

-- organization_settings was a 1:1 table nothing ever read or wrote — its
-- columns move directly onto organizations, which is cheap to load with
-- the org anyway. `features` folds into the pre-existing
-- `organizations.settings` jsonb bucket rather than living alongside it as
-- a second, overlapping generic column.

--changeset worktime:023-fold-organization-settings
ALTER TABLE organizations
    ADD COLUMN enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN enforce_mfa BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN allowed_email_domains TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN session_duration_minutes INTEGER NOT NULL DEFAULT 1440,
    ADD COLUMN ip_allowlist INET[] NOT NULL DEFAULT '{}';

UPDATE organizations o
SET enforce_sso = s.enforce_sso,
    enforce_mfa = s.enforce_mfa,
    allowed_email_domains = s.allowed_email_domains,
    session_duration_minutes = s.session_duration_minutes,
    ip_allowlist = s.ip_allowlist,
    settings = o.settings || s.features
FROM organization_settings s
WHERE s.organization_id = o.id;

DROP TABLE organization_settings;

-- SSO config is a small, rarely-queried per-org blob — a JSON column on
-- organizations avoids a second 1:1 table, the same reasoning as above.
-- Keys mirror the old table's column names so API responses are unchanged.

--changeset worktime:024-fold-sso-configurations
ALTER TABLE organizations
    ADD COLUMN sso_config JSONB NOT NULL DEFAULT '{}';

UPDATE organizations o
SET sso_config = jsonb_build_object(
    'protocol', c.protocol,
    'idp_entity_id', c.idp_entity_id,
    'idp_sso_url', c.idp_sso_url,
    'idp_certificate', c.idp_certificate,
    'metadata_xml', c.metadata_xml,
    'is_active', c.is_active,
    'updated_at', c.updated_at
)
FROM sso_configurations c
WHERE c.organization_id = o.id;

DROP TABLE sso_configurations;
DROP TYPE sso_protocol;
