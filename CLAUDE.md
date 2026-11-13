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
npm install
npm run dev:up             # Docker: pg + migrate + keycloak + mailpit
npm run dev:seed           # demo data (infra/postgres/seeds/seed.sql)
npm run build              # all workspaces (api: tsc; web: tsc --noEmit + vite build)
npm test                   # all workspaces

npm run dev:api            # build + start the API on :8001
npm run dev:web            # Vite on :3001
npm run dev:migrate        # apply Liquibase changelogs (Docker required)
npm run dev:introspect     # regenerate apps/api/src/db/schema.ts + relations.ts from the live DB
npm run dev:psql           # psql into the dev database; dev:down / dev:logs
npm run dev:resetdb        # drop + recreate schema public, migrate, seed (also local:resetdb)
npm run local:up           # whole stack in Docker (.env.local); local:down / local:seed / local:psql
```

Single API test file: `cd apps/api && NODE_PATH=./node_modules npx tsx --conditions=source --test ../../test/api/orgs.test.ts`
(`--conditions=source` makes `@worktime3/shared` resolve to its TypeScript sources).

Environments: **dev** (N=1, `.env.dev`, `compose/docker-compose.dev.yml`) runs
only pg/Keycloak/Mailpit in Docker, with the API and web on the host: pg 5431,
Keycloak 8091, web 3001, API 8001, Mailpit SMTP 1025 / inbox UI 8025. This is
the day-to-day setup. **local** (N=2, `.env.local`) runs everything in Docker
behind Caddy on 5432/8092/3002/8002. The VS Code "Development …" launch configs
debug the host-run API and web against `.env.dev`; "Local Full Stack: Docker +
Chrome" brings up the local compose stack (task `local: stack up`) and opens
Chrome on 3002. Host processes must not run on local's ports, which Caddy holds.

The base npm scripts (`db:migrate`, `db:seed`, `db:introspect`, `build`, `start`)
are environment-agnostic: they read config only from the process environment,
never from an env file, because CI and the VPS/Azure deploys run them with config
from GitHub Environments. The `dev:*` / `local:*` scripts are thin wrappers for
local development: `scripts/with-env.mjs <dev|local> <cmd>` loads `.env.dev` /
`.env.local` (file values win over the shell's, `PG*` derived from `POSTGRES_*`)
and runs a base script or `docker compose`. Add new local conveniences that way;
never make CI, workflows or deploy scripts depend on them or on `.env` files.
`db:seed` exits if `DATABASE_URL` is unset. The API still starts without it, in offline mode
(logged as a WARNING at startup), and every endpoint, including login, then
returns `{ ok: true, offline: true }`. That looks like success but does nothing.

Demo logins (from `seed.sql`): every `<name>@acme.com` user's password is `<name>`
(`admin@acme.com` / `admin`, `marta@acme.com` / `marta`, ...). Acme reporting line:
Alice manages Admin and Adam; Adam manages Marta, Marco and Uma; Marta manages Ulla
(also hr); Marco manages Ueli; Uma is also developer. The Login screen's demo-account dropdown (Admin, Manager = Marta, HR User = Ulla, User = Ueli)
come from the global `static_data` row `login`/`demo_accounts` via public
`GET auth/demo-accounts`; each value is a JSON string `{name, user, password}`.

## Tests

- Most tests are API tests in `test/api/*.test.ts`, using `node:test` +
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
- `apps/web` and `packages/shared` tests are `src/*.test.mjs` run by
  `node --test`; they can import plain `.ts` files (Node strips types) but not
  `.tsx`.
- CI (`.github/workflows/ci.yml`) builds, tests, then runs `db:migrate` and
  `db:seed` against a fresh Postgres 16, so a broken changelog or seed fails CI.

## Database: Liquibase owns schema, Drizzle owns queries

- Schema changes go in a **new** file in `infra/liquibase/changelog/`
  (`NNN-description.sql`, formatted SQL with `--changeset author:id`
  headers), added to `db.changelog-master.xml`. Never edit an existing
  changeset; Liquibase checksums them.
- Then run `npm run db:migrate` and `npm run db:introspect` (drizzle-kit 0.31,
  matching drizzle-orm 0.45; needs `DATABASE_URL` exported).
- `apps/api/src/db/schema.ts` and `relations.ts` are **generated**. Never
  hand-edit them. `scripts/fix-introspected-schema.mjs` patches what drizzle-kit
  gets wrong after introspection (`citext` columns, truncated `COALESCE(... ::uuid)`
  index expressions); extend it rather than editing the output.
- The seed (`infra/postgres/seeds/seed.sql`) is separate from migrations and
  must run cleanly on a freshly migrated database, which CI checks. Insert
  parents before children (e.g. `users` before `organizations`, which
  references them), and use `ON CONFLICT DO NOTHING` for rows that migrations
  already insert (system roles, permissions, some `static_data`).
- To reset a database, drop and recreate the `public` schema, then
  `db:migrate` and `db:seed` (`npm run dev:resetdb` / `local:resetdb` does all three,
  localhost only). Don't just truncate: that deletes the reference
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
  3. Gate with permissions (below) via `can` / `canSeeUserData` / `listableUserIds` /
     `reachesAll` / `canEditBeyondOwn` / `canEditUserData`, plus `isOrgMember`, `isManagerOf`, `isSuperDeveloper`.
     Team Management uses `canManageItem` (scope `own` = teams you lead, projects you own).
     Don't add checks on role names; `isOrgDeveloper` (form design) is the one left.
  4. Work-time and absence writes check `isPeriodLocked` (working-time timesheet month
     submitted/approved); project-time writes check `isProjectPeriodLocked` (that project's
     month in the project timesheet).
- Permissions: ids are `<object>:<action>:<scope>` (`nav.teamHours:see:reports`,
  `section.basicdata.personalien:edit:all`), catalogued in
  `packages/shared/src/permissions.ts` and in Liquibase (035-037), held via
  `membership_roles` -> `role_permissions`. Global roles (`organization_id` NULL) carry the
  defaults (superdevelopers edit them); an org customizes a role by getting its own copy
  (same name; memberships are moved onto it, "reset" moves them back), or creates its own
  roles. Admin settings -> Roles & permissions (`roles.controller.ts`) manages both.
  `edit` implies `see`; a section also requires its parent navbar entry (My data for own
  data, Users for others'). `owner` holds everything; `admin` always keeps role management.
  People's data: `canSeeUserData` = self, the designated manager (always), or a grant
  covering them; admin-only overrides use `canEditBeyondOwn` (ignores everyone's `:edit:own`).
  New navbar entries/sections need a registry entry, catalogue rows and default grants
  (a new `NNN-permission-*.sql` changelog); the catalogue test checks those match the registry.
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
  in `static_data`. Absence types (`absences`/`absence_type`) map each key to
  attributes instead of a label (labels are in `translation`): `{"approval": false}`
  (set for sickness and accident in the global row, 047) records the absence as
  approved and notifies the manager instead of asking. The code keeps no list of
  types; new orgs inherit the global row. "Basic data" (`basicdata.*`) is personal data with an
  HR change-request/approval history.
- Work-time model (`packages/shared/src/worktime.ts`, DB side in
  `work-time-model.service.ts`): a person's target per day comes from their
  `work_schedules` row in force (minutes per weekday, with history; else the org's
  full-time week Mon-Fri), minus public holidays (computed per canton from
  `organizations.settings.holidayRegion`, plus `org_holidays` rows) and approved
  absences. Project time stays independent of attendance, but a day's project time above its
  attendance + `projectTimeToleranceMinutes` returns `project-exceeds-attendance-confirm`
  until the client resends with `acknowledgeAttendance`.
- Balances (`balances.service.ts`, `computeYearBalances` is pure): approving a working-time
  timesheet closes the month into `work_time_months` (reopening deletes it); other months
  are computed live from the model. Overtime = month differences + `balance_adjustments`;
  Überzeit (attendance beyond `legalMaxWeeklyMinutes` per calendar week) is a share of it,
  kept as its own account (`legal_overtime` adjustments move both);
  vacation is in full-time days (entitlement `vacationDaysPerYear` prorated by workload,
  or a `vacation_entitlements` row; carried over). Others' balances and the monthly report
  with alerts are `nav.balances` (Time balances page); one's own are always visible.
- Two timesheets: the working-time timesheet (`timesheet_periods`, `timesheets.controller.ts`,
  Monthly timesheet page) goes to the line manager and closes the month's balance; the project
  timesheet (`project_time_periods`, one row per person, project and month,
  `project-timesheets.controller.ts`) goes to each project's owner (Approvals page), approved
  on submit when the person owns the project or it has none. Hours without a project can't
  be submitted. Work time and project time are changed by the person, their designated manager or
  HR (`canEditUserData`: `nav.workTime` / `nav.time` edit beyond own) and only while the month is
  open; the manager or HR reopens a submitted/approved month (`timesheet-periods/:id/reopen`,
  `project-timesheets/:id/reopen`). The pages pick the person via `time-record-people` (`PersonPicker`).
  Managers and HR also get a Team tab on those pages and on Absences, Expenses and Expense reports
  (`TeamView.tsx`, `GET organizations/:orgId/team-overview?kind=&month=`): one row per person they may
  see (`listableUserIds`, caller excluded), opening that person's page or their entries; Absences adds a
  month calendar with the org's holidays. HR's read access to absences and expenses is 049.
  The work schedule is HR's alone (048); every basic-data section, Personalien included, is
  requested by the employee and approved by HR.

## Web conventions (`apps/web/src`)

- Flat folder of PascalCase page components, lazy-loaded from `App.tsx`,
  which owns the nav drawer, session, org switcher and role gating.
- Each page calls the API directly with
  `fetch(\`${API}/...\`, { headers: await authHeaders() })`, where
  `const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1'`
  is declared per file.
- All UI strings go through i18n: `const t = useT()` from `i18n.tsx`. When you
  add a key, add it to all four dictionaries in `dictionaries.ts` (en/de/fr/it);
  `dictionaries.test.mjs` fails on missing keys or mismatched `{{placeholders}}`.
- Format dates, times and numbers with the app's `locale` from `useI18n()`,
  never the browser default (`toLocaleDateString()` with no argument).
- Configurable form fields (docs/FIELD_CONFIG.md): field definitions live in
  `packages/shared/src/fields.ts` (imported as `@worktime3/shared/fields`) and
  are rendered by `ConfigField` / `ConfigFieldGroup` (`ConfigField.tsx`). Number
  entry and display go through `localeFormat.ts`; date pickers are MUI X with
  dayjs, set up once by `DatePickerLocalization` in `main.tsx`. The basic-data
  and expense forms use them; other forms still have hand-written fields.
- Global and per-org templates (`field_config`, edited by the `developer` role
  and `users.is_superdeveloper`) override the registry. Merging, override
  checks (`checkFieldOverride`) and value validation (`validateFields`) live in
  `fields.ts` so the browser and the API apply the same rules. A form page
  loads its merged template from `GET organizations/:orgId/forms/:formId`; a
  controller saving a configured form validates with
  `FieldsService.resolved()` + `validateFields`, as `basicdata.controller.ts` does.
  In the web app, a page with a configured form uses `useFormTemplate`
  (`designMode.tsx`), wraps the form in `FieldDesignScope` and renders
  `FormDesignPanel` while designing, as `Home.tsx` does.
- Custom fields (defined by a template, `field_config.is_custom`) are stored in
  the form's `customStorage` JSON column. Basic data keeps org-defined ones in
  `users.basicdata.orgs.<orgId>`: read basic data through `scopeToOrg` so one
  org never sees another's section.
- Show API errors to the user. Don't apply changes optimistically and then
  revert them silently.
- Re-resolve the user's role when they switch organizations. Never cache one
  global role.
- Organization look and feel (header/page/sidebar colors, logo as a data URL) lives in
  `organizations.settings.branding`, validated by `packages/shared/src/branding.ts`
  (API and browser), served by `GET/PUT organizations/:id/branding` (edit = `nav.orgSettings`).
  App.tsx loads it per org into `BrandingContext`; `createAppTheme(mode, branding)` applies it.
  Seeded logos are `infra/postgres/seeds/branding/*.svg`, base64-inlined in `seed.sql`.

## Other

- `packages/shared`: `index.ts` (role ids, RBAC matrix) mirrors API constants
  and is not imported yet; `fields.ts` (the field registry) is used by the web
  app and the API, as are `permissions.ts` and `branding.ts`. Keep these to erasable TypeScript (no enums) so Node
  tests can import them. Its `exports` map has a `source` condition (the `.ts`
  sources, used by Vite, the web type check and all tests) and a built `dist/`
  (used by the API, which is CommonJS and loads it via `require` of ESM). The
  API's `build` script builds the shared package first.
- Environments: `compose/docker-compose.{dev,local,vps}.yml`; `local` uses
  `infra/caddy/Caddyfile.local`, `vps` the shared edge in `infra/caddy/edge/`.
  Azure is `infra/azure/provision.sh` (no compose file). `vps` and `azure`
  deploy only through GitHub Actions, with config in GitHub Environments
  (`azure`, and one per VPS instance: `prod`, `preprod`, `test`, ...). A VPS GitHub Environment is one instance: its name sets
  the container prefix, `/opt/worktime3-<env>`, its own Postgres, and `DOMAIN` + `WEB_SUB/API_SUB/AUTH_SUB`
  (optional `MAIL_SUB` for the Mailpit inbox, `PORTAINER_SUB` for Portainer, default `portainer`) set its hostnames. `VPS_HOST/USER` are
  variables, `VPS_SSH_KEY` a secret. Never hand-edit files on the server; change
  `infra/vps/remote.sh` or `infra/caddy/edge/`. `deploy` does not seed: use the
  `vps` workflow's `seed` (additive, needs `SEED <env>`) or `reset-seed` (destructive).
  `seed.sql` must stay re-runnable: fixed keys on every row, `ON CONFLICT DO NOTHING`,
  and UPDATEs that only fill in unset values. Each VPS instance has its own Postgres
  container (`PG_PORT`, role/db `worktime`) and Mailpit; only Caddy is shared (`infra/caddy/edge`).
  Portainer is its own per-server stack (`infra/portainer`, `vps` workflow action `portainer`). Ports follow `8090+N` (Keycloak), `5430+N`
  (pg), `3000+N` (web), `8000+N` (API). Each compose file has a one-shot
  `migrate` service that runs before the API and Keycloak start.
- Keycloak realm config: `infra/keycloak/realm-worktime.json`.
