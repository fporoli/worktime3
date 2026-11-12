# worktime3

Enterprise + individual time tracking: NestJS API, React+MUI web, Postgres,
Keycloak (same database, `auth` schema), and Caddy as the edge reverse proxy
where the deployment uses it.
Schema is versioned with Liquibase; the API talks to Postgres through
Drizzle ORM, typed against that schema.

## Architecture

```
apps/web  (React + MUI, Vite)  --HTTP-->  apps/api  (NestJS)  --Drizzle-->  Postgres
                                               |                                ^
                                               |  validates JWTs                |
                                               v                                |
                                          Keycloak  ------------------------------
                                          (IdP; stores its own tables in the
                                           `auth` schema of the same database)

Caddy fronts web, API, and Keycloak in the `local` Compose
environments. The VPS stack uses the shared edge Caddy; `dev` accesses its
host-run API and web app directly.
```

### Components

| Path | What it is |
| --- | --- |
| `apps/web` | React 18 + MUI + Vite. One PascalCase file per page, lazy-loaded from `App.tsx` (nav drawer, session, org switcher, role gating). |
| `apps/api` | NestJS API, one controller per resource. |
| `packages/shared` | Code shared by web and API: `permissions.ts` (permission catalogue), `fields.ts` (configurable form fields), `branding.ts`, `worktime.ts` (daily targets, holidays, month summaries, vacation entitlement). `index.ts` (role ids, RBAC matrix) is mirrored but not yet imported. |
| `infra/liquibase` | The database schema's source of truth (see below). |
| `infra/postgres/seeds` | `seed.sql`: demo orgs/users/projects/project times/expenses. Run manually, separate from schema migrations. |
| `infra/keycloak` | Realm export (`realm-worktime.json`) imported on Keycloak startup. |
| `infra/caddy` | Environment-specific Caddyfiles plus the shared VPS edge proxy configuration. |
| `infra/vps` | `remote.sh`, the script the `vps` workflow runs on the server. |
| `infra/azure` | `provision.sh`, the Azure Container Apps provisioning phases. |
| `compose/docker-compose.{dev,local,vps}.yml` | Environment-specific stacks (see below). Azure has no compose file. |

**Compose stacks**

| File | What runs in Docker |
| --- | --- |
| `dev` | Postgres, migrations, Keycloak and Mailpit. API and web run on the host. |
| `local` | The full stack, including Caddy. |
| `vps` | One stack per instance (own Postgres, Keycloak, API, web) that joins the server's shared edge proxy network. |

#### Web (`apps/web/src`)

| Area | Files |
| --- | --- |
| Session and shell | `App.tsx` (nav groups, session, org switcher, branding), `Login.tsx` (local + Keycloak SSO + invite-accept), `Home`, `NotificationBell`, `UserMenu` |
| My work | `WorkTime` (check-in/out), `Absences`, `Timesheet` (monthly working-time timesheet for the line manager), `MyData` (`BasicDataPanel`), `BalancesPanel` (overtime/vacation by month) |
| Projects | `ProjectTime` (hours per project), `ProjectTimesheet` (monthly submission to each project's owner) |
| Expenses | `Expenses`, `ExpenseReports`, `ExpenseProcessing` |
| Organization | `Approvals`, `TeamHours`, `BalanceReport` (Time balances with alerts), `Management` (teams/projects/subprojects), `Invitations`, `Users` (`WorkSchedulePanel`), `OrganizationSettings` (`WorkTimeSettings`, `BrandingSettings`) |
| Admin | `AdminSettings` (static-data enums), `RolesPermissions`, `FormDesigner`, `AuditLog` |
| Form fields | `ConfigField`, `designMode.tsx` (configurable forms, see `docs/FIELD_CONFIG.md`) |
| AI | `Assistant` (chat) |
| Support modules | `auth.ts` (Keycloak client + token refresh), `aggregate.ts` (daily/weekly/monthly bucketing), `i18n.tsx` (en/de/fr/it) |

#### API (`apps/api/src`)

| Area | Controllers |
| --- | --- |
| Identity | `auth`, `users`, `basicdata`, `orgs`, `roles`, `permissions`, `fields` |
| Organization | `teams`, `projects` (+ subprojects) |
| Time | `work-time`, `absences`, `work-schedules`, `timesheets`, `balances`, `project-time`, `project-timesheets` |
| Expenses | `expenses`, `expense-reports` |
| Cross-cutting | `workflows`, `static-data`, `audit`, `assistant`, `notifications` (+ WebSocket gateway) |

| Module | Role |
| --- | --- |
| `access.ts` | Authorization helpers every controller calls (`callerUserId`, `can`, `canSeeUserData`, period locks, …), resolved from the caller's validated JWT, never trusted from the request body. |
| `work-time-model.service.ts`, `balances.service.ts` | Daily targets (schedules, holidays, absences) and the monthly overtime/vacation balances. |
| `jwt.ts` / `jwt.guard.ts` | Validate local HS256 tokens and Keycloak-issued tokens (JWKS) behind one global guard. Routes opt out with `@Public()`. |
| `db.service.ts` | Wraps a single `pg.Pool` and exposes a typed Drizzle client via `getDb()`. |
| `db/schema.ts`, `relations.ts` | **Generated, not hand-written** (see Database below). |

### Request flow

1. The web app obtains a token (local HS256 login or Keycloak SSO, see
   `auth.ts`) and sends it as a bearer token on every call. Each page calls
   the API directly under the global prefix `/api/v1`; there is no shared
   client layer or state store.
2. The global `JwtAuthGuard` validates the token (local secret or Keycloak
   JWKS) and attaches `req.user`. Routes marked `@Public()` skip the guard.
3. The handler gets the Drizzle client from `DbService.getDb()`, resolves the
   caller's user id from the validated token (`callerUserId`), and checks
   access with the helpers in `access.ts`. Every org-scoped handler does this
   itself; there is no central policy layer.
4. Writes go through Drizzle, then record history via
   `VersionsService.record(...)` (tables carry no `created_at`/`updated_at`)
   and, where relevant, create notifications and send best-effort mail.
5. Errors come back as data, not exceptions: `{ ok: false, error: 'kebab-code' }`
   on failure, `{ ok: true, ... }` on success, and empty shapes for reads the
   caller may not see.

### Multi-tenancy and authorization

- Data is partitioned by organization. A user can belong to several
  organizations through `organization_memberships`, and the web app
  re-resolves the user's role whenever the org switcher changes.
- Roles are per organization, and a membership can hold several
  (`membership_roles`). Access is decided by **permissions**, not role names:
  ids of the form `<object>:<action>:<scope>` (`nav.balances:see:reports`,
  `section.basicdata.personalien:edit:all`), catalogued in
  `packages/shared/src/permissions.ts` and granted to roles through
  `role_permissions`. Global roles carry the defaults; an organization can
  customize a role (it gets its own copy) or create its own, under Admin
  settings -> Roles & permissions.
- Authorization helpers in `access.ts`:

  | Helper | Passes for |
  | --- | --- |
  | `isOrgMember` | Any member of the org |
  | `can` | Callers holding a permission (`edit` implies `see`) |
  | `canSeeUserData` / `listableUserIds` | Self, the person's designated manager, or a grant covering them |
  | `reachesAll` / `canEditBeyondOwn` | Grants covering everyone / admin-only overrides |
  | `isManagerOf` | The specific manager of a member |
  | `canManageItem` / `canManageTeamMembers` | Team leads and project owners (scope `own`) |
  | `isSuperDeveloper` / `isOrgDeveloper` | Global and per-org form designers |
- "Manager of X" is the specific `organization_memberships.manager_user_id`,
  so approvals route to the member's own manager, not to any manager in the
  org.
- Time writes additionally check a period lock: work time and absences
  `isPeriodLocked` (the working-time timesheet month is submitted or
  approved), project time `isProjectPeriodLocked` (that project's month in the
  project timesheet). A locked month is read-only until it is reopened.

### Domain areas

The API keeps these concerns separate; each has its own controller/service
and tables:

| Area | What it is | Where |
| --- | --- | --- |
| Work time | Check-in/check-out attendance | `work-time.*` |
| Work-time model | Daily targets: work schedules, canton and org holidays, approved absences | `work-time-model.service.ts`, `work-schedules.controller.ts`, `packages/shared/src/worktime.ts` |
| Working-time timesheet | Monthly attendance and absences, approved by the line manager; approval closes the month's balance | `timesheets.controller.ts` |
| Balances | Overtime (minutes) and vacation (days), by month and year, with carry-over, adjustments and a monthly alert report | `balances.*` |
| Project time | Hours booked against projects and subprojects, independent of attendance | `project-time.*`, `projects.controller.ts` |
| Project timesheet | Each person's monthly hours per project, approved by the project's owner (for billing) | `project-timesheets.controller.ts` |
| Expenses | Expense items and expense reports | `expenses.controller.ts`, `expense-reports.controller.ts` |
| Basic data | Personal data with an HR change-request/approval history | `basicdata.*` |
| Static data | Admin-editable dropdown vocabularies | `static-data.controller.ts` |
| Audit | Version history of changed rows | `versions.service.ts`, `audit.*` |

### Approval workflows and notifications

Timesheets, expense reports, absences, and timesheet reopen requests all go
through `workflows.service.ts`. A submission is routed to the requester's
manager; a project timesheet goes to the project's owner instead (approved
right away when the person owns the project or it has none). Each state change creates a notification through
`notifications.service.ts`. That service persists the row and pushes it to
connected clients over the WebSocket gateway at `/ws/notifications`, which the
web app consumes via `useNotifications.ts` and `NotificationBell`.

### AI assistant

`assistant.service.ts` uses the OpenAI SDK against Gemini's or OpenAI's
compatible endpoint, with tool-calling. Every tool runs the same
authorization as its REST equivalent, using the caller's real identity, so the
assistant can never see or do more than the user could through the UI. Without
`GEMINI_API_KEY`/`OPENAI_API_KEY` it returns
`{ ok: false, error: 'assistant-not-configured' }`.

### Graceful degradation

The API is built to start and answer even when pieces are missing:

- Without `DATABASE_URL` it runs in offline mode (a startup warning is
  logged) and every endpoint, including login, returns
  `{ ok: true, offline: true }`. This looks like success but does nothing.
- Mail is best-effort and never fails a request.
- The assistant degrades as described above.

### Schema ownership

Liquibase owns the schema and Drizzle owns the queries. Changelogs in
`infra/liquibase/changelog/` are the source of truth. `schema.ts` and
`relations.ts` are regenerated from the migrated database with
`npm run db:introspect`, never edited by hand. Details are in the next
section.

## Database: Liquibase (schema) + Drizzle (queries)

**Liquibase owns the schema.** `infra/liquibase/changelog/` holds one file
per logical change (`001-initial-schema.sql`, `002-worktime-extensions.sql`,
…), written as Liquibase's *formatted SQL* changelogs (plain SQL with
`--changeset author:id` headers), listed in order by
`db.changelog-master.xml`. Liquibase tracks exactly which changesets have
run inside the database itself (`databasechangelog` table), so applying the
changelog is always safe to repeat — this is what makes environments stay in
sync instead of quietly drifting from whatever `schema.sql` happened to look
like when a given database was first created.

Applying it uses the official `liquibase/liquibase` Docker image with the
Postgres JDBC driver baked in (`infra/liquibase/Dockerfile` — the base image
ships without a driver):
- **Compose environments**: the `migrate` service in every
  `compose/docker-compose.*.yml` runs it automatically before `api`/Keycloak
  start (`depends_on: migrate: condition: service_completed_successfully`).
- **Outside compose** (a host-run API, or CI): `npm run db:migrate` — a thin
  Node wrapper (`infra/liquibase/migrate.mjs`) that builds the image and
  points it at `$DATABASE_URL`.

**Drizzle owns the query layer**, typed against whatever Liquibase has
applied. `apps/api/src/db/schema.ts` and `relations.ts` are generated by
introspecting the live database — never hand-edit them. `scripts/
fix-introspected-schema.mjs` patches what `drizzle-kit introspect`
gets wrong (Postgres's `citext` type, used by `users.email`/`organizations.slug`/
etc., has no built-in mapping; some `COALESCE(... ::uuid)` index expressions
come out truncated) so the command stays a single, rerunnable
step.

**Making a schema change:**
1. Add a new changelog file (e.g. `003-my-change.sql`) with its own
   `--changeset` header(s); add it to `db.changelog-master.xml`.
2. Apply it: `npm run db:migrate` (or let the `migrate` compose service do
   it on next `up`).
3. Regenerate types: `npm run db:introspect` (from `apps/api`, or
   `npm run db:introspect` at the repo root).
4. Update the controller(s) using the new/changed columns.

Never edit `schema.ts`/`relations.ts` by hand, and never edit an already-
applied changelog file — Liquibase checksums each changeset and will refuse
to reapply a modified one; add a new changeset instead.

Seed data (`infra/postgres/seeds/seed.sql`) is separate from schema
migrations and stays manual: `npm run db:seed`. It is additive and safe to re-run:
it adds missing demo rows and keeps demo data changed since. A deployed instance is
never seeded by `deploy`: use the `vps` workflow's `seed` (additive) or `reset-seed`
(clean slate), or the `azure` workflow's `seed` / `initdb`.

## Host ports (8090+N keycloak, 5430+N pg, 3000+N web, 8000+N api)

| Env | N | pg | keycloak | web | api |
|---|---|----|----------|-----|-----|
| dev (pg+kc in containers, api+web local) | 1 | 5431 | 8091 | 3001 | 8001 |
| local (all dockerized) | 2 | 5432 | 8092 | 3002 | 8002 |
| VPS instances (one stack each; only `pg` is published, on `127.0.0.1:PG_PORT`, reachable via SSH tunnel) | — | 5433 production, 5434 preprod, 5435 test (your choice) | edge | edge | edge |

Azure uses Container Apps ingress, not host ports. On the VPS the shared edge
proxy routes each instance's three hostnames (`WEB_SUB`, `API_SUB`, `AUTH_SUB`
under `DOMAIN`; production uses `wt`, `wtservice`, `wtauth` under
`turbotapir.com`) to its web, API and Keycloak containers.

## Dev and Local deployment

Each environment has its own env file: `.env.dev` (N=1) and `.env.local`
(N=2), copied once from `env.example.dev.cfg` / `env.example.local.cfg`.
The `dev:*` and `local:*` npm scripts load that file for you
(`scripts/with-env.mjs`; the file's values win over your shell's), on macOS,
Linux and Windows alike. The base scripts underneath (`db:migrate`, `db:seed`,
`start`, …) read only the process environment; CI and the deploys call them
with config from GitHub. `db:seed` refuses to run without `DATABASE_URL`, and
the API logs an OFFLINE warning at startup without it.

| Script | Does |
| --- | --- |
| `dev:up` / `dev:down` / `dev:logs` | pg + migrate + Keycloak + Mailpit in Docker |
| `dev:api` | build and start the API (http://localhost:8001) |
| `dev:web` | Vite (http://localhost:3001) |
| `dev:migrate` / `dev:seed` / `dev:introspect` | database tasks against the dev database |
| `dev:psql` | psql into the dev database |
| `dev:resetdb` | **Destructive.** Drop and recreate the dev database's `public` schema, migrate, seed (Keycloak's `auth` schema is kept) |
| `local:up` / `local:down` / `local:logs` | the whole stack in Docker behind Caddy |
| `local:migrate` / `local:seed` / `local:psql` | database tasks against the local database |
| `local:resetdb` | **Destructive.** The same reset for the local database |

To run any other command with an environment loaded:
`node scripts/with-env.mjs dev <command> [args...]`.

**dev** (pg + Keycloak + Mailpit in Docker, API + web on the host):

```sh
cp env.example.dev.cfg .env.dev        # once; Windows: copy
npm install
npm run dev:up                         # pg + migrate + keycloak + mailpit
npm run dev:seed
npm run build
npm test
```

Then run the API and web app on the host (separate terminals), or use the
"Development Full Stack: API + Web" VS Code launch config:

```sh
npm run dev:api    # http://localhost:8001
npm run dev:web    # vite, http://localhost:3001
```

**local** (everything in Docker, behind Caddy):

```sh
cp env.example.local.cfg .env.local    # once
npm run local:up
npm run local:seed
```

### Demo accounts

Each seeded `<name>@acme.com` user's password is `<name>` (e.g.
`admin@acme.com` / `admin`). Local dev builds show a demo-account dropdown on the
login screen with Admin, Manager (Marta) and User (Ulla); picking one signs in.
Its entries are global static data (entity `login`, enum `demo_accounts`; each
value a JSON string `{"name","user","password"}`), served by the public
`GET /api/v1/auth/demo-accounts`.
On the VPS the dropdown is controlled per instance by the `SHOW_DEMO_ACCOUNTS`
variable (default `false`); the Azure image always shows them. The accounts
exist only after a seed (`reset-seed` on the VPS). Otherwise provision real
Keycloak accounts; the realm import does not create users.
Invite token `dev-invite-0001` accepts an invitation as `invited@acme.com`.

## Roles

Default grants of the global roles (organizations can change them, see
Multi-tenancy and authorization above):

- `user`: own work time, absences, timesheets, project time and data.
- `manager`: + their reports' data and approvals, team hours, balance report,
  invitations, teams, subprojects (only if project owner).
- `hr`: + everyone's personal data and balances, adjustments.
- `admin`: + static data, organization settings (name/domains/SSO, work time,
  branding), roles & permissions, audit read.
- `owner`: everything.

## Auth

Keycloak realm `worktime` (see `infra/keycloak/realm-worktime.json`).

## Email

The API sends mail via [nodemailer](https://nodemailer.com), configured from
`SMTP_HOST/PORT/FROM/USER/PASSWORD/SECURE` (see `env.example.dev.cfg`). Sends are
best-effort: a missing or misconfigured server never fails a request.

| Environment | Where mail goes |
| --- | --- |
| `dev` | Own [Mailpit](https://github.com/axllent/mailpit) catcher: SMTP `localhost:1025`, inbox UI `:8025`. The host-run API points at it via `.env.dev`. |
| `local` | Own Mailpit: SMTP `:1026`, inbox UI `:8026` (offset so both can run at once). The `api` container is wired to it in the compose file. |
| `vps` | Without `SMTP_HOST`, the instance's own Mailpit (`worktime3-<env>-mailpit`). Set `MAIL_SUB` to publish its inbox at `<MAIL_SUB>.<DOMAIN>` behind basic auth (user `admin`). |
| `azure` | `SMTP_HOST` is unset by default, so mail silently no-ops. See below to use a real relay. |

Mailpit has no auth and nothing real is sent.

**Real relay (e.g. on Azure):** set `SMTP_HOST/PORT/FROM/USER` as environment
variables and `SMTP_PASSWORD` as a secret (plus `SMTP_SECURE=true` for an
implicit-TLS relay, typically port 465). nodemailer negotiates STARTTLS/AUTH
itself, so any standard relay (SES, SendGrid, Mailgun, etc.) works without code
changes.

**Endpoints that trigger mail or account flows**

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/auth/register` | Welcome mail |
| `POST /api/v1/organizations/:id/invite` | Org-invite mail |
| `POST /api/v1/auth/onboard` | Self-onboarding |
| `POST /api/v1/auth/reset-password` | Password reset |
| `POST /api/v1/auth/azure/link` | Azure link |
| `DELETE /api/v1/auth/azure/link/:userId` | Azure unlink |

## CI

`.github/workflows/ci.yml` builds, tests, and — against a throwaway Postgres
service container — runs `db:migrate` then `db:seed`, so a broken changelog
fails the build before it reaches any real environment.

## Deploy

The `vps` and `azure` workflows are manual (`workflow_dispatch`) and take all
their config from GitHub Environments (Settings > Environments), not from files
on a server or laptop. `dev` and `local` keep using `.env.dev` / `.env.local`.

### VPS

**One GitHub Environment = one instance.** Production is the environment named
`prod`; create another (e.g. `preprod`) to get a second instance, on the same
server or another one: production (`wt`), `preprod` (`wtpp`) and `test`
(`wttest`) can all run on one host.

**Secrets**

| Name | Notes |
| --- | --- |
| `VPS_SSH_KEY` | Private key, no passphrase |
| `POSTGRES_PASSWORD` | Hex only, it goes into a URL |
| `KEYCLOAK_ADMIN_PASSWORD` | |
| `API_JWT_SECRET` | |
| `SMTP_PASSWORD` | Optional |
| `GEMINI_API_KEY` or `OPENAI_API_KEY` | Optional, turns on the AI assistant (Gemini wins if both are set) |
| `GHCR_TOKEN` | Optional, `read:packages`, only for private images |

**Variables**

| Name | Notes |
| --- | --- |
| `VPS_HOST`, `VPS_USER` | Server and deploy user |
| `PG_PORT` | This instance's Postgres loopback port; unique per server, e.g. 5433/5434/5435 |
| `DOMAIN` | e.g. `turbotapir.com` |
| `WEB_SUB`, `API_SUB`, `AUTH_SUB` | e.g. `wtpp`, `wtservicepp`, `wtauthpp` |
| `KEYCLOAK_ADMIN` | |
| `SHOW_DEMO_ACCOUNTS` | Optional, `true`/`false` |
| `GHCR_USERNAME` | Optional |
| `SMTP_HOST/PORT/FROM/USER/SECURE` | Optional |
| `GEMINI_MODEL`, `OPENAI_MODEL` | Optional, the assistant's model (defaults `gemini-3.6-flash` / `gpt-4o-mini`) |
| `MAIL_SUB` | Optional, publishes the instance's Mailpit inbox at `<MAIL_SUB>.<DOMAIN>` |
| `PORTAINER_SUB` | Optional, Portainer hostname `<PORTAINER_SUB>.<DOMAIN>`, default `portainer`. Set it per server when servers share a `DOMAIN`, e.g. `portainerpp`. |

**Workflow actions.** Run the `vps` workflow from `main`, naming the
environment and an `image_tag` (prefer a `sha-` tag over `latest`):

| Action | What it does |
| --- | --- |
| `deploy` | Ships the deploy files over SSH and runs `infra/vps/remote.sh`. |
| `portainer` | (Re)deploys Portainer, the Docker UI for the whole server, at `portainer.<DOMAIN>`. It is its own stack in `/opt/edge/portainer`, so instance deploys never touch it. Run it once per server, with any environment of that server (it uses that environment's `DOMAIN`). |
| `portainer-remove` | Takes Portainer down and keeps its data volume. |
| `destroy` | **Destructive.** Removes the instance (containers, its Postgres and volume, `/opt/worktime3-<env>`, its Caddy site, and its database on a leftover `edge-pg` if there is one). A last dump stays in the deploy user's home. The shared edge stack and other instances stay. Confirmation text: `DESTROY <environment>`. |
| `seed` | Loads the demo data into a deployed instance, adding only what is missing: nothing is dropped, and demo data changed since (passwords, reporting lines) is kept. Use it after a release adds demo rows. It creates demo users with known passwords, so not for production. Confirmation text: `SEED <environment>`. |
| `reset-seed` | **Destructive.** Backs up and recreates the `public` schema, migrates, loads the demo data and checks a demo login. Needs the confirmation text. A new instance has no users until you run it once. |

**What `remote.sh` does.** It derives everything instance-specific from the
environment name:

- Containers (`worktime3-<env>-api`, ...), Compose project and `/opt/worktime3-<env>`.
- Its own Postgres (`worktime3-<env>-pg`, role and database `worktime`, volume per
  Compose project), bound to `127.0.0.1:PG_PORT` on the server.
- Its own Caddy site at the three hostnames.
- Writes `compose/.env` and `/opt/edge/.env`, creates the `edge` network if
  missing and brings up the edge stack (`infra/caddy/edge`: just the Caddy
  shared by all instances) before the instance's `pg`, `mailpit`, `migrate`,
  `api` and Keycloak.

Other things to know:

- The server keeps no git checkout and no hand-edited config.
- One web image serves every instance: its API and Keycloak URLs are filled in
  when the container starts.
- Values must not contain a single quote.
- A leftover `edge-pg` (the old shared Postgres) is not used any more: remove it
  with `docker rm -f edge-pg`.

**Server prerequisites**

- Docker with the compose plugin.
- `VPS_USER` is in the `docker` group and owns `/opt/edge` and each
  `/opt/worktime3*` directory (one `sudo chown -R "$USER": /opt/edge /opt/worktime3*`
  after the first manual setup, or after anything root created them).
- DNS A records pointing at the server for the three hostnames,
  `<PORTAINER_SUB>.<DOMAIN>` (default `portainer`) and, if set, each `MAIL_SUB`
  hostname.
- Create the Portainer admin right after its first start: it locks itself after
  5 minutes without one (an existing admin survives the move out of the edge
  stack, because the data volume is reused).

**Reaching an instance's Postgres.** It listens on the server's loopback only,
so use an SSH tunnel:

```sh
ssh -N -L 5434:127.0.0.1:<PG_PORT> <VPS_USER>@<VPS_HOST>
```

Then connect a normal client to `localhost:5434` as role `worktime`, database
`worktime`, with that environment's `POSTGRES_PASSWORD`.

### Azure environment

The `azure` GitHub Environment uses the same names as `azure.yml` lists
(`AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID`, `POSTGRES_PASSWORD`, …).
For the AI assistant, add the secret `GEMINI_API_KEY` (or `OPENAI_API_KEY`) and
optionally the variable `GEMINI_MODEL` / `OPENAI_MODEL`; they reach the API when
`azure.yml` provisions the apps (`azure-deploy` only swaps images, so rerun the
apps phase after adding them).
Environment values override repo-level ones, so existing repo secrets keep
working until you move them.

### Releases

Push a `v*` tag to cut a release (`git tag v1.2.0 && git push origin v1.2.0`).
`build-push` then publishes images tagged `v1.2.0`, without moving `latest`;
deploy them by passing that as `image_tag`. Every image also records its nearest
tag (`git describe`, so `v1.2.0-3-g97d21cd` for a later commit on main), commit
and commit date, which the app shows under the user menu's **Information**
(web and API separately, since they are deployed as separate images). Images
built before any tag exists show as untagged; host builds as local.

### Azure Container Apps

The apps run as Container Apps in a plain Consumption environment (no custom
VNet, which would add an always-on load balancer):
`worktime3-auth` (Keycloak), `worktime3-api`, `worktime3-web`, plus the
`worktime3-migrate` and `worktime3-seed` jobs. Postgres is an Azure Database
for PostgreSQL Flexible Server (Burstable B1ms, public endpoint open only to
Azure services, TLS required, `citext`/`uuid-ossp` allowlisted via `azure.extensions`). `build-push` publishes the extra
`migrate`, `seed`, `dbtools` and `web-azure` images; `web-azure` has the Azure hostnames
baked in from the repo variables `AZURE_API_URL` / `AZURE_KEYCLOAK_URL`.

First deploy, from Git Bash with the Azure CLI logged into the target tenant:

```sh
cp infra/azure/env.example.azure.cfg infra/azure/.env.azure   # fill in
bash infra/azure/provision.sh base     # network, Postgres, storage, environment; prints gh commands
#   set the printed repo variables, then run build-push and wait for it
bash infra/azure/provision.sh apps     # migrations, keycloak, api, web
bash infra/azure/provision.sh seed     # optional demo data, fresh database only
bash infra/azure/provision.sh github   # deploy identity; prints gh secret commands
bash infra/azure/provision.sh secrets  # copies .env.azure to the secrets the azure-* workflows read
```

After that, `azure-deploy` (manual) runs migrations and rolls api/web to an
image tag. Backups are Flexible Server's built-in daily ones (7 days).

Day-to-day operations are `provision.sh` phases. Run them from the Actions tab
with the single `azure` workflow: pick an action from the dropdown. They run
from `main` only, which is the one ref the deploy identity trusts. A code
rollout is the separate `azure-deploy` workflow.

| Action | What it does |
|---|---|
| `freeze` | Stops the apps and Postgres. Storage is still billed, and Azure restarts a stopped server after 7 days, so re-run it before then. |
| `unfreeze` | Starts Postgres and the apps. |
| `deepfreeze` | Stops the apps, dumps the database to the `db-dumps` blob container, then deletes the Postgres server. The server is kept if the dump fails. |
| `deepunfreeze` | Recreates the server, restores the newest dump, starts the apps. |
| `dropdb` | Stops the apps and deletes the server with no dump. All data is lost; you must type the server name in `confirm`. |
| `initdb` | Creates an empty server, runs migrations, starts the apps. Refuses if a server exists. The `seed` checkbox also loads the demo data. |
| `seed` | Loads the demo data, fresh database only. |
| `apps` | Re-applies the app specs after a config or secret change. |

`base` and `github` have no workflow: they need more rights than the deploy
identity has. `azure-deploy` needs a running database, so unfreeze first.

To reach the database from a laptop (psql, DBeaver, ...), open the firewall for
your IP while you need it, and close it again afterwards:

```sh
az postgres flexible-server firewall-rule create -g <rg> -n <server> -r laptop \
  --start-ip-address <your ip> --end-ip-address <your ip>
az postgres flexible-server firewall-rule delete -g <rg> -n <server> -r laptop --yes
```

Connect to `<server>.postgres.database.azure.com` as `worktime` with
`POSTGRES_PASSWORD` and `sslmode=require`.
