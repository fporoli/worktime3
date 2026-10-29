# CLAUDE.md

Multi-tenant time tracking: NestJS API (`apps/api`), React 18 + MUI + Vite web
(`apps/web`), Postgres, Keycloak (same DB, `auth` schema), Caddy edge proxy.
npm workspaces, Node >= 24. `README.md` covers architecture, ports and deploy;
`docs/BUILD_PROMPT.md` holds the product spec and the architectural rules
below in full; `docs/DATABASE_SCHEMA.md` describes the tables.

## Commands

Run from the repo root unless noted.

```sh
cp env.example.dev.cfg .env.dev   # once; Windows: copy
. ./env.dev.sh                    # export .env.dev into the shell (Windows: call env.dev.bat)
docker compose -f compose/docker-compose.dev.yml up -d   # pg + migrate + keycloak + mailpit
npm install
npm run db:seed            # demo data (infra/postgres/seeds/seed.sql); needs DATABASE_URL exported
npm run build              # all workspaces (api: tsc; web: tsc --noEmit + vite build)
npm test                   # all workspaces

npm run start --workspace=@worktime3/api   # API on :8001 (needs a prior build)
npm run dev --workspace=@worktime3/web     # Vite on :3001

npm run db:migrate         # apply Liquibase changelogs to $DATABASE_URL (Docker required)
npm run db:introspect      # regenerate apps/api/src/db/schema.ts + relations.ts from the live DB
```

Single API test file: `cd apps/api && NODE_PATH=./node_modules npx tsx --test ../../test/api/orgs.test.ts`.

Environments: **dev** (N=1, `.env.dev`, `compose/docker-compose.dev.yml`) runs
only pg/Keycloak/Mailpit in Docker, with the API and web on the host: pg 5431,
Keycloak 8091, web 3001, API 8001, Mailpit SMTP 1025 / inbox UI 8025. This is
the day-to-day setup. **local** (N=2, `.env.local`) runs everything in Docker
behind Caddy on 5432/8092/3002/8002. The VS Code launch configs "Development …"
and "Local …" debug the API against `.env.dev` and `.env.local` respectively.

npm scripts are environment-agnostic. They read all config from the shell and
never from an env file, so source `env.dev.sh` / `env.local.sh` first. Don't
add per-environment script variants or `--env-file` flags. `db:seed` exits if
`DATABASE_URL` is unset. The API still starts without it, in offline mode
(logged as a WARNING at startup), and every endpoint, including login, then
returns `{ ok: true, offline: true }`. That looks like success but does nothing.

Demo logins (from `seed.sql`, used by the Login screen buttons):
`admin@acme.com`, `marta@acme.com` (manager), `ulla@acme.com` (user), password `dev1234`.

## Tests

- All real tests are API tests in `test/api/*.test.ts`, using `node:test` +
  `node:assert`, run through `tsx` from the `apps/api` workspace. No Nest boot,
  no database: controllers are constructed directly with hand-rolled mock
  `DbService`/service objects (see `project-time-auth.test.ts`), and pure
  helpers exported from controllers/services are tested directly
  (`nextMonthStart`, `isValidEmail`, `vacationDebitMinutes`, …).
- Some tests mirror logic instead of importing it (`rbac.test.ts`,
  `project-time.test.ts`). Prefer importing the real function.
- Several tests do `import type { AuthenticatedRequest } from '../../apps/api/src/types'`,
  which does not exist (the type lives in `jwt.guard.ts`). It works only
  because tsx strips type-only imports; use `jwt.guard` in new tests.
- `apps/web` and `packages/shared` have `test` scripts but no test files yet.
- CI (`.github/workflows/ci.yml`) builds, tests, then runs `db:migrate` and
  `db:seed` against a fresh Postgres 16, so a broken changelog or seed fails CI.

## Database: Liquibase owns schema, Drizzle owns queries

- Schema changes go in a **new** file in `infra/liquibase/changelog/`
  (`NNN-description.sql`, formatted SQL with `--changeset author:id`
  headers), added to `db.changelog-master.xml`. Never edit an existing
  changeset; Liquibase checksums them.
- Then run `npm run db:migrate` and `npm run db:introspect`.
- `apps/api/src/db/schema.ts` and `relations.ts` are **generated**. Never
  hand-edit them. `scripts/fix-introspected-schema.mjs` patches `citext`
  columns after introspection.
- The seed (`infra/postgres/seeds/seed.sql`) is separate from migrations and
  must run cleanly on a freshly migrated database, which CI checks. Insert
  parents before children (e.g. `users` before `organizations`, which
  references them), and use `ON CONFLICT DO NOTHING` for rows that migrations
  already insert (system roles, permissions, some `static_data`).
- To reset a database, drop and recreate the `public` schema, then
  `db:migrate` and `db:seed`. Don't just truncate: that deletes the reference
  data the migrations insert. Keycloak's tables live in the `auth` schema;
  leave it alone.
- Regular tables have no `created_at`/`updated_at` columns. Record history
  through `VersionsService.record(table, id, action, actorUserId, row)` after
  writes (fire-and-forget with `.catch(() => {})`), not with timestamp columns.

## API conventions (`apps/api/src`)

- Flat layout: `name.controller.ts` / `name.service.ts`, one controller per
  resource, all registered in `app.module.ts` (add new controllers and
  providers there). Global prefix `api/v1`.
- Auth: global `JwtAuthGuard` (`jwt.guard.ts`) accepts local HS256 tokens
  (`API_JWT_SECRET`) and Keycloak JWKS tokens. Use `@Public()` to opt a route out.
  Handlers take `@Req() req: AuthenticatedRequest`.
- **Every org-scoped handler authorizes itself**, using helpers from `access.ts`:
  1. `const db = this.db.getDb(); if (!db) return <offline/empty shape>;`
  2. `const userId = req.user ? await callerUserId(db, req.user) : null;`
     Never trust a user id from the body or query for the caller.
  3. Gate with `isOrgMember` / `isOrgManagerOrAdmin` / `isOrgAdmin` /
     `isOrgHrOrAdmin` / `isOrgBillingAdmin` / `isManagerOf` /
     `canManageTeamMembers` / `isOwnerAdminOrManagerOf` as appropriate.
  4. Time-entry writes also check `isPeriodLocked` (submitted/approved month).
- Roles are per organization. A membership can hold several roles
  (`membership_roles`). "Manager of X" means `organization_memberships.manager_user_id`,
  so approvals route to that specific manager, not to any org manager.
- Errors are returned, not thrown: `{ ok: false, error: 'kebab-code' }`
  (e.g. `forbidden`, `period-locked`, `unknown-user`); success is `{ ok: true, ... }`.
  Read endpoints return empty shapes on denial.
- Degrade gracefully: no `DATABASE_URL` means offline/empty responses; mail
  (`mailer.ts`, nodemailer) is best-effort and never fails a request; the
  assistant returns `{ ok: false, error: 'assistant-not-configured' }`
  without `GEMINI_API_KEY`/`OPENAI_API_KEY`.
- AI assistant (`assistant.service.ts`): OpenAI SDK pointed at Gemini's or
  OpenAI's compatible endpoint, with tool-calling. Each tool must run the same
  authorization as its REST equivalent, using the caller's real identity.
- Domain terms: **project time** (`project_times`, hours booked against
  projects) is separate from **work time** (`work_times`, check-in/check-out
  attendance) and from **balances** (vacation/overtime, `balances.service.ts`).
  Approval flows (timesheets, expense reports, absences, timesheet reopen) go
  through `workflows.service.ts` and create notifications
  (`notifications.service.ts`, which persists rows and pushes over the WS
  gateway at `/ws/notifications`). Admin-editable dropdown vocabularies live
  in `static_data`. "Basic data" (`basicdata.*`) is personal data with an
  HR change-request/approval history.

## Web conventions (`apps/web/src`)

- Flat folder of PascalCase page components, lazy-loaded from `App.tsx`,
  which owns the nav drawer, session, org switcher and role gating.
- Each page calls the API directly with
  `fetch(\`${API}/...\`, { headers: await authHeaders() })`, where
  `const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1'`
  is declared per file.
- All UI strings go through i18n: `const t = useT()` from `i18n.tsx`. When you
  add a key, add it to all four dictionaries in `DICTIONARIES` (en/de/fr/it).
- Show API errors to the user. Don't apply changes optimistically and then
  revert them silently.
- Re-resolve the user's role when they switch organizations. Never cache one
  global role.

## Other

- `packages/shared` (role ids, RBAC matrix) mirrors API constants but is not
  imported by either app yet.
- Environments: `compose/docker-compose.{dev,local,vps,azure}.yml` with
  `infra/caddy/Caddyfile.<env>`. Ports follow `8090+N` (Keycloak), `5430+N`
  (pg), `3000+N` (web), `8000+N` (API). Each compose file has a one-shot
  `migrate` service that runs before the API and Keycloak start.
- Keycloak realm config: `infra/keycloak/realm-worktime.json`.
