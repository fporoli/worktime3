# Worktime Database Schema

Postgres · Liquibase · Drizzle ORM

17 tables across six subsystems, all scoped to a tenant through `organization_id` —
which is `NOT NULL` on `work_times`, since every entry belongs to an organization
whether or not it's tagged to a project. Each section below is a self-contained
entity-relationship diagram for one subsystem; tables that also appear elsewhere
(mainly `organizations` and `users`) are shown with just their primary key for
context — their full column list lives in the section where they're introduced.

**Notation:** `PK` primary key · `FK` foreign key · `UK` unique constraint.
Timestamps (`created_at`/`updated_at`) are omitted from the diagrams for clarity.

## Identity & Organizations (4 tables)

Users, how they authenticate, and the tenant tree they belong to. Security
settings and SSO federation live directly on the organization row, not in side
tables.

```mermaid
erDiagram
    USERS ||--o{ USER_IDENTITIES : "authenticates via"
    USERS ||--o{ ORGANIZATIONS : "created_by_user_id"
    ORGANIZATIONS ||--o{ ORGANIZATION_DOMAINS : "claims"
    ORGANIZATIONS ||--o{ ORGANIZATIONS : "parent_organization_id"

    USERS {
        uuid id PK
        citext email UK
        varchar display_name
        enum status
        varchar locale
    }
    USER_IDENTITIES {
        uuid id PK
        uuid user_id FK
        enum provider "password / google / apple / github / saml_sso / oidc / passkey"
        varchar provider_user_id
        varchar password_hash "nullable"
    }
    ORGANIZATIONS {
        uuid id PK
        uuid parent_organization_id FK "self-referencing, nullable"
        citext slug UK
        varchar name
        enum type "personal / team / enterprise"
        uuid created_by_user_id FK
        boolean enforce_sso
        boolean enforce_mfa
        text_array allowed_email_domains
        int session_duration_minutes "default 1440"
        inet_array ip_allowlist
        jsonb sso_config "protocol, idp_entity_id, idp_sso_url, is_active…"
        jsonb settings "generic per-org feature bucket"
    }
    ORGANIZATION_DOMAINS {
        uuid id PK
        uuid organization_id FK
        citext domain UK
        boolean auto_join_enabled
    }
```

> Folded in from two 1:1 tables that used to sit beside `organizations` —
> `organization_settings` (flattened into real columns) and
> `sso_configurations` (kept as the `sso_config` JSON blob, same field names).

## Access Control / RBAC (6 tables)

Roles can be system-wide (`organization_id` null) or scoped to one org. A
membership now holds **any number** of roles at once, through
`membership_roles` — permissions are additive across them.

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ ROLES : "defines"
    ROLES ||--o{ ROLE_PERMISSIONS : "grants"
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "granted via"
    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERSHIPS : "admits"
    USERS ||--o{ ORGANIZATION_MEMBERSHIPS : "joins"
    ORGANIZATION_MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : "holds"
    ROLES ||--o{ MEMBERSHIP_ROLES : "granted as"
    USERS ||--o{ MEMBERSHIP_ROLES : "granted_by_user_id"
    ORGANIZATIONS ||--o{ ORGANIZATION_INVITATIONS : "sends"
    ROLES ||--o{ ORGANIZATION_INVITATIONS : "pre-assigns"
    USERS ||--o{ ORGANIZATION_INVITATIONS : "invited_by_user_id"

    ROLES {
        uuid id PK
        uuid organization_id FK "null = system role"
        varchar name
        boolean is_system_role
        jsonb translations "locale -> display_name"
        uuid_array admin_user_ids "may grant/revoke THIS role for others"
    }
    PERMISSIONS {
        varchar id PK "e.g. teams:manage"
        varchar description
    }
    ROLE_PERMISSIONS {
        uuid role_id PK "FK -> roles"
        varchar permission_id PK "FK -> permissions"
    }
    ORGANIZATION_MEMBERSHIPS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        enum status "active / invited / suspended"
    }
    MEMBERSHIP_ROLES {
        uuid membership_id PK "FK -> organization_memberships"
        uuid role_id PK "FK -> roles"
        timestamptz granted_at
        uuid granted_by_user_id FK "nullable"
    }
    ORGANIZATION_INVITATIONS {
        uuid id PK
        uuid organization_id FK
        citext email
        uuid role_id FK "single role — extra roles are granted after acceptance"
        varchar token UK
        enum status "pending / accepted / revoked / expired"
    }
    USERS { uuid id PK }
    ORGANIZATIONS { uuid id PK }
```

> One membership row per `(organization_id, user_id)` — `uq_org_user_membership`
> — but any number of rows in `membership_roles` for it. Granting or revoking a
> role requires being an org owner/admin, or being listed in that role's own
> `admin_user_ids`.

## Teams (2 tables)

A team rosters existing org memberships, not users directly — a manager and a
team-specific role can be layered on each seat.

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ TEAMS : "has"
    TEAMS ||--o{ TEAM_MEMBERS : "rosters"
    ORGANIZATION_MEMBERSHIPS ||--o{ TEAM_MEMBERS : "placed as"
    USERS ||--o{ TEAM_MEMBERS : "manager_user_id"
    ROLES ||--o{ TEAM_MEMBERS : "team_role_id"

    TEAMS {
        uuid id PK
        uuid organization_id FK
        varchar name "unique per org"
        varchar description
    }
    TEAM_MEMBERS {
        uuid team_id PK "FK -> teams"
        uuid membership_id PK "FK -> organization_memberships"
        uuid manager_user_id FK "nullable"
        uuid team_role_id FK "nullable"
    }
    ORGANIZATION_MEMBERSHIPS { uuid id PK }
    USERS { uuid id PK }
    ROLES { uuid id PK }
    ORGANIZATIONS { uuid id PK }
```

## Projects & Time Tracking (3 tables)

Work entries tag an optional project/subproject; both fall back to null on
delete rather than orphan the entry.

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ PROJECTS : "owns"
    PROJECTS ||--o{ SUBPROJECTS : "breaks into"
    USERS ||--o{ PROJECTS : "owner_user_id"
    USERS ||--o{ SUBPROJECTS : "owner_user_id"
    USERS ||--o{ WORK_TIMES : "logs"
    ORGANIZATIONS ||--o{ WORK_TIMES : "scopes"
    PROJECTS ||--o{ WORK_TIMES : "tags"
    SUBPROJECTS ||--o{ WORK_TIMES : "tags"

    PROJECTS {
        uuid id PK
        uuid organization_id FK
        varchar name
        uuid owner_user_id FK "nullable"
        enum type "internal / customer / research"
    }
    SUBPROJECTS {
        uuid id PK
        uuid project_id FK
        uuid organization_id FK
        varchar name
        enum type "phase / work_package / task"
    }
    WORK_TIMES {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK "required — every entry is org-scoped"
        uuid project_id FK "nullable"
        uuid subproject_id FK "nullable"
        timestamptz start_time
        timestamptz end_time "check: end_time > start_time"
    }
    ORGANIZATIONS { uuid id PK }
    USERS { uuid id PK }
```

## Timesheets (1 table)

Month-end lock/approve state for a person's booked hours.

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ TIMESHEET_PERIODS : "locks by month"
    USERS ||--o{ TIMESHEET_PERIODS : "owns"
    USERS ||--o{ TIMESHEET_PERIODS : "reviewed_by_user_id"

    TIMESHEET_PERIODS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        date period_start
        date period_end "check: period_end > period_start"
        enum status "open / submitted / approved / rejected"
        uuid reviewed_by_user_id FK "nullable"
        text review_note
    }
    ORGANIZATIONS { uuid id PK }
    USERS { uuid id PK }
```

> One period per `(organization_id, user_id, period_start)` —
> `uq_timesheet_period`. Work-time writes are rejected once the covering
> period is `submitted` or `approved`.

## Audit (1 table + 1 view)

Every administrative action (invites, timesheet review, SSO/domain config,
role grants) writes one row here.

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ AUDIT_LOGS : "scopes"
    USERS ||--o{ AUDIT_LOGS : "actor_user_id"

    AUDIT_LOGS {
        uuid id PK
        uuid organization_id FK
        uuid actor_user_id FK "nullable, set null if the user is deleted"
        varchar action "e.g. sso.upsert, timesheet.approve, invitation.send, role.grant"
        varchar target_type
        varchar target_id
        jsonb metadata
    }
    ORGANIZATIONS { uuid id PK }
    USERS { uuid id PK }
```

> `audit` is a read-only view over `audit_logs` exposing the same rows under
> legacy column names (`uuid`, `entity`, `actionby`) — not a separate table.

## Enumerated Types (8 enums)

| Enum | Values |
|---|---|
| `user_status` | `active`, `suspended`, `deactivated` |
| `auth_provider_type` | `password`, `google`, `apple`, `github`, `saml_sso`, `oidc`, `passkey` |
| `organization_type` | `personal`, `team`, `enterprise` |
| `membership_status` | `active`, `invited`, `suspended` |
| `invitation_status` | `pending`, `accepted`, `revoked`, `expired` |
| `project_type` | `internal`, `customer`, `research` |
| `subproject_type` | `phase`, `work_package`, `task` |
| `timesheet_status` | `open`, `submitted`, `approved`, `rejected` |

## Not diagrammed

- `static_data` — a standalone, non-tenant-scoped table of admin-managed
  enum/dropdown values (no foreign keys).
- Liquibase's own bookkeeping tables `databasechangelog` /
  `databasechangeloglock`.

---

Generated from `apps/api/src/db/schema.ts` (Drizzle ORM, introspected from the
Liquibase-managed schema) on 2026-09-11. A styled, interactive version of this
reference is also published as a Claude artifact.
