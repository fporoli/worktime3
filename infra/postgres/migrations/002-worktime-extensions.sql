-- 002-worktime-extensions.sql
-- Deltas on top of schema.sql to cover the requested domain.
-- Idempotent where cheap; run after schema.sql. Postgres 14+.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- 1. Users: extra profile fields requested -------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Organizations: country + generic company settings -------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS country VARCHAR(2);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- 3. Roles: settings + translations --------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS role_translations (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    locale VARCHAR(10) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    PRIMARY KEY (role_id, locale)
);

-- 4. Memberships (OrgRoleMember): is_active flag --------------------------
ALTER TABLE organization_memberships ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 5. Teams: description + manager/team-role on members --------------------
ALTER TABLE teams ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS team_role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

-- 6. Projects / Subprojects / WorkTime ------------------------------------
DO $$ BEGIN
  CREATE TYPE project_type AS ENUM ('internal', 'customer', 'research');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subproject_type AS ENUM ('phase', 'work_package', 'task');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    cost_item VARCHAR(255),
    type project_type NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);

CREATE TABLE IF NOT EXISTS subprojects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    cost_item VARCHAR(255),
    type subproject_type NOT NULL DEFAULT 'phase',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subprojects_project ON subprojects(project_id);
CREATE INDEX IF NOT EXISTS idx_subprojects_org ON subprojects(organization_id);

CREATE TABLE IF NOT EXISTS work_times (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    subproject_id UUID REFERENCES subprojects(id) ON DELETE SET NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_worktime_order CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_worktimes_user_start ON work_times(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_worktimes_project ON work_times(project_id);

-- 7. Static Data (generic enum table from the spec) ------------------------
CREATE TABLE IF NOT EXISTS static_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity VARCHAR(128) NOT NULL,
    entity_uuid UUID,
    enum_name VARCHAR(128) NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    translation JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_static_data_entity ON static_data(entity, enum_name);

-- 8. Audit: keep audit_logs as canonical; expose spec-shaped view ---------
CREATE OR REPLACE VIEW audit AS
SELECT id AS uuid,
       target_type AS entity,
       target_id AS entity_uuid,
       action,
       actor_user_id AS actionby,
       organization_id,
       created_at
FROM audit_logs;
