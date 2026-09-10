--liquibase formatted sql

-- Ported from the former schema.sql (see git history). The destructive
-- `DROP TABLE/TYPE ... CASCADE` preamble that file used for "clean runs" is
-- intentionally dropped here: Liquibase changesets are additive and
-- tracked — each one applies exactly once, ever, per database. To reset a
-- database for local dev, drop the whole database/volume instead of relying
-- on a changeset to blow away and recreate tables.

--changeset worktime:001-extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
-- Keycloak uses the `auth` schema of this database (see KC_DB_URL currentSchema=auth).
-- It never creates the schema itself, so we do it here.
CREATE SCHEMA IF NOT EXISTS auth;

--changeset worktime:002-identity-layer
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deactivated');

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               CITEXT UNIQUE NOT NULL,
    email_verified_at   TIMESTAMPTZ,
    display_name        VARCHAR(100) NOT NULL,
    avatar_url          VARCHAR(1024),
    locale              VARCHAR(10) NOT NULL DEFAULT 'en',
    timezone            VARCHAR(50) NOT NULL DEFAULT 'UTC',
    status              user_status NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS 'Global human identity. Persists across private and enterprise contexts.';

CREATE TYPE auth_provider_type AS ENUM (
    'password',
    'google',
    'apple',
    'github',
    'saml_sso',
    'oidc',
    'passkey'
);

CREATE TABLE user_identities (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            auth_provider_type NOT NULL,
    provider_user_id    VARCHAR(255) NOT NULL,
    password_hash       VARCHAR(255),
    metadata            JSONB NOT NULL DEFAULT '{}',
    last_sign_in_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_user_id UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);
COMMENT ON TABLE user_identities IS 'Decoupled credentials. A single user can link passwords, OAuth, and Enterprise SSO.';

--changeset worktime:003-tenancy
CREATE TYPE organization_type AS ENUM ('personal', 'team', 'enterprise');

CREATE TABLE organizations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
    slug                    CITEXT UNIQUE NOT NULL,
    name                    VARCHAR(100) NOT NULL,
    type                    organization_type NOT NULL DEFAULT 'personal',
    avatar_url              VARCHAR(1024),
    created_by_user_id      UUID NOT NULL REFERENCES users(id),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_parent ON organizations(parent_organization_id);
COMMENT ON TABLE organizations IS 'Security and data boundary. Private use = personal organization with 1 seat.';

CREATE TABLE organization_settings (
    organization_id             UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    enforce_sso                 BOOLEAN NOT NULL DEFAULT FALSE,
    enforce_mfa                 BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_email_domains       TEXT[] NOT NULL DEFAULT '{}',
    session_duration_minutes    INTEGER NOT NULL DEFAULT 1440,
    ip_allowlist                INET[] NOT NULL DEFAULT '{}',
    features                    JSONB NOT NULL DEFAULT '{}',
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE organization_settings IS 'Enterprise security rules, MFA enforcement, and feature flags.';

CREATE TABLE organization_domains (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain              CITEXT NOT NULL,
    verification_token  VARCHAR(255) NOT NULL,
    verified_at         TIMESTAMPTZ,
    auto_join_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_domain UNIQUE (domain)
);

CREATE INDEX idx_org_domains_domain ON organization_domains(domain);
COMMENT ON TABLE organization_domains IS 'Verified enterprise domains for automatic directory joining or SSO enforcement.';

CREATE TYPE sso_protocol AS ENUM ('saml2', 'oidc');

CREATE TABLE sso_configurations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    protocol            sso_protocol NOT NULL DEFAULT 'saml2',
    idp_entity_id       VARCHAR(512) NOT NULL,
    idp_sso_url         VARCHAR(1024) NOT NULL,
    idp_certificate     TEXT,
    metadata_xml        TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_sso UNIQUE (organization_id)
);

--changeset worktime:004-permissions-and-memberships
CREATE TABLE permissions (
    id          VARCHAR(64) PRIMARY KEY,
    description VARCHAR(255) NOT NULL
);

CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(64) NOT NULL,
    description     VARCHAR(255),
    is_system_role  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_role_per_org UNIQUE NULLS NOT DISTINCT (organization_id, name)
);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   VARCHAR(64) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TYPE membership_status AS ENUM ('active', 'invited', 'suspended');

CREATE TABLE organization_memberships (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id             UUID NOT NULL REFERENCES roles(id),
    status              membership_status NOT NULL DEFAULT 'active',
    scim_external_id    VARCHAR(255),
    joined_at           TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_user_membership UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_memberships_user ON organization_memberships(user_id);
CREATE INDEX idx_memberships_org ON organization_memberships(organization_id);
CREATE INDEX idx_memberships_scim ON organization_memberships(scim_external_id);

CREATE TABLE teams (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    description     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_team_name UNIQUE (organization_id, name)
);

CREATE TABLE team_members (
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    membership_id   UUID NOT NULL REFERENCES organization_memberships(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, membership_id)
);

CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE organization_invitations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email               CITEXT NOT NULL,
    role_id             UUID NOT NULL REFERENCES roles(id),
    token               VARCHAR(255) UNIQUE NOT NULL,
    invited_by_user_id  UUID NOT NULL REFERENCES users(id),
    status              invitation_status NOT NULL DEFAULT 'pending',
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_email ON organization_invitations(email);
CREATE INDEX idx_invitations_token ON organization_invitations(token);

--changeset worktime:005-audit-logs
CREATE TABLE audit_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    action              VARCHAR(128) NOT NULL,
    target_type         VARCHAR(64) NOT NULL,
    target_id           VARCHAR(255) NOT NULL,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_org_date ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);

--changeset worktime:006-seed-permissions
INSERT INTO permissions (id, description) VALUES
    ('org:admin', 'Full administrative access to organization settings and billing'),
    ('org:billing', 'Manage subscriptions, payment methods, and invoices'),
    ('members:manage', 'Invite, modify, and remove members'),
    ('teams:manage', 'Create and modify team structures'),
    ('sso:configure', 'Configure SAML/OIDC and domain verifications'),
    ('audit:read', 'Export and inspect enterprise audit logs'),
    ('data:read', 'Read resources inside organization'),
    ('data:write', 'Create and edit resources inside organization'),
    ('projects:manage', 'Create and manage projects and subprojects'),
    ('worktime:approve', 'Approve submitted work times');

--changeset worktime:007-seed-system-roles
INSERT INTO roles (id, organization_id, name, description, is_system_role) VALUES
    ('00000000-0000-0000-0000-000000000001', NULL, 'owner', 'Full organization owner and legal contact', TRUE),
    ('00000000-0000-0000-0000-000000000002', NULL, 'admin', 'Organization administrator', TRUE),
    ('00000000-0000-0000-0000-000000000003', NULL, 'member', 'Standard collaborator with read/write access', TRUE),
    ('00000000-0000-0000-0000-000000000004', NULL, 'guest', 'Restricted access to assigned teams/projects only', TRUE),
    ('00000000-0000-0000-0000-000000000005', NULL, 'billing_admin', 'Can manage billing and subscription tiers only', TRUE),
    ('00000000-0000-0000-0000-000000000006', NULL, 'manager', 'Manager with team, project, and subproject access', TRUE);

--changeset worktime:008-seed-role-permissions
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'org:admin'),
    ('00000000-0000-0000-0000-000000000001', 'org:billing'),
    ('00000000-0000-0000-0000-000000000001', 'members:manage'),
    ('00000000-0000-0000-0000-000000000001', 'teams:manage'),
    ('00000000-0000-0000-0000-000000000001', 'sso:configure'),
    ('00000000-0000-0000-0000-000000000001', 'audit:read'),
    ('00000000-0000-0000-0000-000000000001', 'data:read'),
    ('00000000-0000-0000-0000-000000000001', 'data:write'),
    ('00000000-0000-0000-0000-000000000001', 'projects:manage'),
    ('00000000-0000-0000-0000-000000000001', 'worktime:approve'),
    ('00000000-0000-0000-0000-000000000002', 'org:admin'),
    ('00000000-0000-0000-0000-000000000002', 'members:manage'),
    ('00000000-0000-0000-0000-000000000002', 'teams:manage'),
    ('00000000-0000-0000-0000-000000000002', 'sso:configure'),
    ('00000000-0000-0000-0000-000000000002', 'audit:read'),
    ('00000000-0000-0000-0000-000000000002', 'data:read'),
    ('00000000-0000-0000-0000-000000000002', 'data:write'),
    ('00000000-0000-0000-0000-000000000002', 'projects:manage'),
    ('00000000-0000-0000-0000-000000000002', 'worktime:approve'),
    ('00000000-0000-0000-0000-000000000006', 'members:manage'),
    ('00000000-0000-0000-0000-000000000006', 'teams:manage'),
    ('00000000-0000-0000-0000-000000000006', 'data:read'),
    ('00000000-0000-0000-0000-000000000006', 'data:write'),
    ('00000000-0000-0000-0000-000000000006', 'projects:manage'),
    ('00000000-0000-0000-0000-000000000003', 'data:read'),
    ('00000000-0000-0000-0000-000000000003', 'data:write'),
    ('00000000-0000-0000-0000-000000000004', 'data:read'),
    ('00000000-0000-0000-0000-000000000005', 'org:billing');
