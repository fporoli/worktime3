-- ============================================================================
-- UNIFIED USER & TENANT DATA MODEL (PostgreSQL 14+)
-- Supports: Private / B2C (Personal Workspace) & Enterprise / B2B (Multi-Org)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Keycloak uses the `auth` schema of this database (see KC_DB_URL currentSchema=auth).
-- It never creates the schema itself, so we do it here.
CREATE SCHEMA IF NOT EXISTS auth;

-- ----------------------------------------------------------------------------
-- CLEANUP (For clean runs / migrations testing)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS team_members CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS organization_invitations CASCADE;
DROP TABLE IF EXISTS organization_memberships CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS sso_configurations CASCADE;
DROP TABLE IF EXISTS organization_domains CASCADE;
DROP TABLE IF EXISTS organization_settings CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS user_identities CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS sso_protocol CASCADE;
DROP TYPE IF EXISTS invitation_status CASCADE;
DROP TYPE IF EXISTS membership_status CASCADE;
DROP TYPE IF EXISTS organization_type CASCADE;
DROP TYPE IF EXISTS auth_provider_type CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;

-- ----------------------------------------------------------------------------
-- 1. IDENTITY LAYER
-- ----------------------------------------------------------------------------
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
    password_hash       VARCHAR(255),          -- Populated only when provider = 'password'
    metadata            JSONB NOT NULL DEFAULT '{}', -- IdP profile claims, WebAuthn credentials, etc.
    last_sign_in_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_user_id UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);
COMMENT ON TABLE user_identities IS 'Decoupled credentials. A single user can link passwords, OAuth, and Enterprise SSO.';

-- ----------------------------------------------------------------------------
-- 2. TENANCY & ENTERPRISE BOUNDARY
-- ----------------------------------------------------------------------------
CREATE TYPE organization_type AS ENUM ('personal', 'team', 'enterprise');

CREATE TABLE organizations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL, -- Enterprise multi-workspace hierarchy
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
    session_duration_minutes    INTEGER NOT NULL DEFAULT 1440, -- 24 hours default
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

-- ----------------------------------------------------------------------------
-- 3. PERMISSIONS & MEMBERSHIPS (RBAC / ReBAC)
-- ----------------------------------------------------------------------------
CREATE TABLE permissions (
    id          VARCHAR(64) PRIMARY KEY, -- e.g. 'workspace:manage', 'members:invite'
    description VARCHAR(255) NOT NULL
);

CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = System built-in role
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
    scim_external_id    VARCHAR(255), -- For automated SCIM sync from Okta / Azure Entra ID
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

-- ----------------------------------------------------------------------------
-- 4. ENTERPRISE COMPLIANCE & AUDIT LOGS
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    action              VARCHAR(128) NOT NULL,
    target_type         VARCHAR(64) NOT NULL,
    target_id           VARCHAR(255) NOT NULL,
    metadata            JSONB NOT NULL DEFAULT '{}', -- IP address, User-Agent, state diffs
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_org_date ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);

-- ----------------------------------------------------------------------------
-- 5. SEED DATA (Standard Roles & Permissions)
-- ----------------------------------------------------------------------------
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

-- Built-in system roles (organization_id IS NULL)
INSERT INTO roles (id, organization_id, name, description, is_system_role) VALUES
    ('00000000-0000-0000-0000-000000000001', NULL, 'owner', 'Full organization owner and legal contact', TRUE),
    ('00000000-0000-0000-0000-000000000002', NULL, 'admin', 'Organization administrator', TRUE),
    ('00000000-0000-0000-0000-000000000003', NULL, 'member', 'Standard collaborator with read/write access', TRUE),
    ('00000000-0000-0000-0000-000000000004', NULL, 'guest', 'Restricted access to assigned teams/projects only', TRUE),
    ('00000000-0000-0000-0000-000000000005', NULL, 'billing_admin', 'Can manage billing and subscription tiers only', TRUE),
    ('00000000-0000-0000-0000-000000000006', NULL, 'manager', 'Manager with team, project, and subproject access', TRUE);

-- Map permissions to system roles
INSERT INTO role_permissions (role_id, permission_id) VALUES
    -- Owner has all permissions
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
    -- Admin
    ('00000000-0000-0000-0000-000000000002', 'org:admin'),
    ('00000000-0000-0000-0000-000000000002', 'members:manage'),
    ('00000000-0000-0000-0000-000000000002', 'teams:manage'),
    ('00000000-0000-0000-0000-000000000002', 'sso:configure'),
    ('00000000-0000-0000-0000-000000000002', 'audit:read'),
    ('00000000-0000-0000-0000-000000000002', 'data:read'),
    ('00000000-0000-0000-0000-000000000002', 'data:write'),
    ('00000000-0000-0000-0000-000000000002', 'projects:manage'),
    ('00000000-0000-0000-0000-000000000002', 'worktime:approve'),
    -- Manager
    ('00000000-0000-0000-0000-000000000006', 'members:manage'),
    ('00000000-0000-0000-0000-000000000006', 'teams:manage'),
    ('00000000-0000-0000-0000-000000000006', 'data:read'),
    ('00000000-0000-0000-0000-000000000006', 'data:write'),
    ('00000000-0000-0000-0000-000000000006', 'projects:manage'),
    -- Member
    ('00000000-0000-0000-0000-000000000003', 'data:read'),
    ('00000000-0000-0000-0000-000000000003', 'data:write'),
    -- Guest
    ('00000000-0000-0000-0000-000000000004', 'data:read'),
    -- Billing Admin
    ('00000000-0000-0000-0000-000000000005', 'org:billing');


