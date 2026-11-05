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

- **apps/web** — React 18 + MUI + Vite. One PascalCase file per page,
  lazy-loaded from `App.tsx` (nav drawer, session, org switcher, role gating):
  `Login.tsx` (local + Keycloak SSO + invite-accept flows), `Home`,
  project-time entry in `App.tsx`, `WorkTime` (check-in/out), `Absences`,
  `Timesheet`, `Approvals`, `Expenses` / `ExpenseReports` /
  `ExpenseProcessing`, `TeamHours`, `Management` (teams/projects/subprojects),
  `Invitations`, `Users`, `AdminSettings` (static-data enums),
  `OrganizationSettings`, `AuditLog`, `Assistant` (AI chat), plus
  `NotificationBell`. `auth.ts` (Keycloak client + token refresh),
  `aggregate.ts` (daily/weekly/monthly bucketing), `i18n.tsx` (en/de/fr/it).
- **apps/api** — NestJS. One controller per resource
  (`auth`, `users`, `basicdata`, `orgs`, `roles`, `teams`, `projects`
  [+ subprojects], `project-time`, `work-time`, `absences`, `balances`,
  `timesheets`, `expenses`, `expense-reports`, `workflows`, `static-data`,
  `audit`, `assistant`, `notifications` [+ WebSocket gateway]). `access.ts` holds the
  authorization helpers every controller calls (`isOrgAdmin`,
  `isOrgManagerOrAdmin`, `callerUserId`, …) — resolved from the caller's
  validated JWT, never trusted from the request body. `jwt.ts`/`jwt.guard.ts`
  validate both local HS256 tokens and Keycloak-issued tokens (JWKS) behind
  one global guard; routes opt out with `@Public()`. `db.service.ts` wraps a
  single `pg.Pool` and exposes a typed Drizzle client via `getDb()`.
  `src/db/schema.ts` and `relations.ts` are **generated, not hand-written**
  (see Database below).
- **packages/shared** — cross-cutting TS types/constants (role ids, RBAC
  permission matrix) mirrored — not yet consumed — by both apps.
- **infra/liquibase** — the database schema's source of truth (see below).
- **infra/postgres/seeds** — `seed.sql`: demo orgs/users/projects/project
  times/expenses, run manually, separate from schema migrations.
- **infra/keycloak** — realm export (`realm-worktime.json`) imported on
  Keycloak startup.
- **infra/caddy** — environment-specific Caddyfiles plus the shared VPS edge
  proxy configuration.
- **compose/docker-compose.{dev,local,vps}.yml** — environment-specific
  stacks. `dev` runs Postgres, migrations, Keycloak, and Mailpit in Docker,
  with API/web on the host. `local` runs the full stack, including Caddy, in
  Docker. `vps` is one stack per instance (own Postgres, Keycloak, API, web)
  that joins the server's shared edge proxy network. Azure has no compose file (`infra/azure/provision.sh`).
- **infra/vps** — `remote.sh`, the script the `vps` workflow runs on the server.
- **infra/azure** — `provision.sh`, the Azure Container Apps provisioning phases.

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
fix-introspected-schema.mjs` patches the one gap `drizzle-kit introspect`
has (Postgres's `citext` type, used by `users.email`/`organizations.slug`/
etc., has no built-in mapping) so the command stays a single, rerunnable
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
migrations and stays manual: `npm run db:seed`. A deployed instance is never
seeded by `deploy`: use the `vps` workflow's `reset-seed` or the `azure`
workflow's `seed` / `initdb`.

## Host ports (8090+N keycloak, 5430+N pg, 3000+N web, 8000+N api)

| Env | N | pg | keycloak | web | api |
|---|---|----|----------|-----|-----|
| dev (pg+kc in containers, api+web local) | 1 | 5431 | 8091 | 3001 | 8001 |
| local (all dockerized) | 2 | 5432 | 8092 | 3002 | 8002 |
| VPS instances (one stack each; only `pg` is published, on `PG_PORT`) | — | 5433 production, 5434 preprod, 5435 test (your choice) | edge | edge | edge |

Azure uses Container Apps ingress, not host ports. On the VPS the shared edge
proxy routes each instance's three hostnames (`WEB_SUB`, `API_SUB`, `AUTH_SUB`
under `DOMAIN`; production uses `wt`, `wtservice`, `wtauth` under
`turbotapir.com`) to its web, API and Keycloak containers.

## Dev and Local deployment

Each environment has its own env file: `.env.dev` (N=1) and `.env.local`
(N=2), copied from `env.example.dev.cfg` / `env.example.local.cfg`.
`env.dev.sh` / `env.local.sh` (Windows: `call env.dev.bat` /
`call env.local.bat`) export that file's variables into the current shell.
The npm scripts are environment-agnostic and read everything (`DATABASE_URL`
etc.) from the shell, so load an environment first. `db:seed` refuses to
run without `DATABASE_URL`, and the API logs an OFFLINE warning at startup.

**dev** (pg + Keycloak + Mailpit in Docker, API + web on the host):

```sh
cp env.example.dev.cfg .env.dev        # Windows: copy
. ./env.dev.sh                         # Windows: call env.dev.bat
docker compose -f compose/docker-compose.dev.yml up -d   # pg + migrate + keycloak + mailpit
npm install
npm run db:seed
npm run build --workspaces
npm run test --workspaces
```

Then run the API and web app on the host (separate terminals), or use the
"Development Full Stack: API + Web" VS Code launch config:

```sh
npm run start --workspace=@worktime3/api   # http://localhost:8001 (after . ./env.dev.sh)
npm run dev --workspace=@worktime3/web     # vite, http://localhost:3001
```

**local** (everything in Docker, behind Caddy):

```sh
cp env.example.local.cfg .env.local
. ./env.local.sh
docker compose -f compose/docker-compose.local.yml up -d --build
npm run db:seed
```

### Demo accounts

Local dev builds show demo login buttons for the seeded users `admin@acme.com`,
`marta@acme.com` (manager) and `ulla@acme.com` (user), password `dev1234`.
On the VPS the buttons are controlled per instance by the `SHOW_DEMO_ACCOUNTS`
variable (default `false`); the Azure image always shows them. The accounts
exist only after a seed (`reset-seed` on the VPS). Otherwise provision real
Keycloak accounts; the realm import does not create users.
Invite token `dev-invite-0001` accepts an invitation as `invited@acme.com`.

## Roles

- `user`: log own work time, daily/weekly/monthly overview.
- `manager`: + invite members, teams, subprojects (only if project owner).
- `admin`: + static data, organization settings (name/domains/SSO), audit read.

## Auth

Keycloak realm `worktime` (see `infra/keycloak/realm-worktime.json`).

## Email

The API sends mail via [nodemailer](https://nodemailer.com), configured from
`SMTP_HOST/PORT/FROM/USER/PASSWORD/SECURE` (see `env.example.dev.cfg`). Sends are
best-effort — a missing/misconfigured server never fails a request.

- **`dev` and `local`** (non-prod): each runs its own
  [Mailpit](https://github.com/axllent/mailpit) catcher — `dev` on
  `localhost:1025` / inbox UI `:8025`, `local` on `:1026` / `:8026` (offset so
  both can run at once). The host-run API in `dev` points at it via
  `.env.dev`; the `api` container in `local` is wired to it in the compose
  file. No auth, nothing real is sent.
- **`vps`**: without `SMTP_HOST` the api uses the instance's own Mailpit
  (`worktime3-<env>-mailpit`), so nothing is sent for real. Set `MAIL_SUB` to
  publish its inbox at `<MAIL_SUB>.<DOMAIN>` behind basic auth (user `admin`). **`azure`**: `SMTP_HOST` is unset by default (mail silently
  no-ops). To send through a real relay set `SMTP_HOST/PORT/FROM/USER` as
  environment variables, `SMTP_PASSWORD` as a secret (+ `SMTP_SECURE=true`
  for an implicit-TLS relay, typically port 465);
  nodemailer negotiates STARTTLS/AUTH itself, so any standard relay (SES,
  SendGrid, Mailgun, etc.) works without code changes.

Currently sent: welcome mail on `POST /api/v1/auth/register`, org-invite mail
on `POST /api/v1/organizations/:id/invite`.
Self-onboarding + password reset: `POST /api/v1/auth/onboard`, `POST /api/v1/auth/reset-password`.
Azure link/unlink: `POST /api/v1/auth/azure/link`, `DELETE /api/v1/auth/azure/link/:userId`.

## CI

`.github/workflows/ci.yml` builds, tests, and — against a throwaway Postgres
service container — runs `db:migrate` then `db:seed`, so a broken changelog
fails the build before it reaches any real environment.

## Deploy

- The `vps` and `azure` workflows are manual (`workflow_dispatch`) and take all their
  config from GitHub Environments (Settings > Environments), not from files on a
  server or laptop. `dev` and `local` keep using `.env.dev` / `.env.local`.
  - **VPS: one GitHub Environment = one instance.** Production is the environment
    named `prod`; create another (e.g. `preprod`) to get a second instance, on the
    same server or another one: production (`wt`), `preprod` (`wtpp`) and `test`
    (`wttest`) can all run on one host. Each environment holds:
    - Secrets: `VPS_SSH_KEY` (private key, no passphrase), `POSTGRES_PASSWORD` (hex
      only, it goes into a URL), `KEYCLOAK_ADMIN_PASSWORD`, `API_JWT_SECRET`, optional
      `SMTP_PASSWORD` and `GHCR_TOKEN` (`read:packages`, only for private images).
    - Variables: `VPS_HOST`, `VPS_USER`, `PG_PORT` (this instance's published Postgres
      port; unique per server, e.g. 5433/5434/5435), `DOMAIN` (e.g. `turbotapir.com`), the three
      subdomains `WEB_SUB`, `API_SUB`, `AUTH_SUB` (e.g. `wtpp`, `wtservicepp`,
      `wtauthpp`), `KEYCLOAK_ADMIN`, and optionally `SHOW_DEMO_ACCOUNTS`
      (`true`/`false`), `GHCR_USERNAME`, `SMTP_HOST/PORT/FROM/USER/SECURE` and
      `TOOLS_SUFFIX`. The suffix renames the shared tools' hosts (`pp` gives
      `portainerpp.`, `mailpp.`); set it when two servers use the same
      `DOMAIN`, otherwise their tool hostnames collide.

    Run the `vps` workflow from `main`, naming the environment and an `image_tag`
    (prefer a `sha-` tag over `latest`):
    - `deploy` ships the deploy files over SSH and runs `infra/vps/remote.sh`.
    - `destroy` is destructive: it removes the instance (containers, its Postgres and
      volume, `/opt/worktime3-<env>`, its Caddy site, and its database on a leftover
      `edge-pg` if there is one). A last dump stays in the deploy user's home. The shared edge
      stack and other instances stay. Confirmation text: `DESTROY <environment>`.
    - `reset-seed` is destructive: it backs up and recreates the `public` schema,
      migrates, loads the demo data and checks a demo login. It needs the
      confirmation text. A new instance has no users until you run it once.

    `remote.sh` derives everything instance-specific from the environment name:
    containers (`worktime3-<env>-api`, ...), Compose project, `/opt/worktime3-<env>`,
    its own Postgres (`worktime3-<env>-pg`, role and database `worktime`, volume per
    Compose project) published on `PG_PORT`, and its own Caddy site at the three
    hostnames. It also writes `compose/.env` and `/opt/edge/.env`, creates the
    `edge` network if missing and brings up the edge stack (`infra/caddy/edge`: Caddy,
    Portainer, shared by all instances and following `DOMAIN`) before the
    instance's `pg`, `mailpit`, `migrate`, `api` and Keycloak. A leftover `edge-pg` (the old shared
    Postgres) is not used any more: remove it with `docker rm -f edge-pg`.
    The server keeps no git checkout and no hand-edited config. One web image serves
    every instance: its API and Keycloak URLs are filled in when the container starts.
    Values must not contain a single quote.

    Server prerequisites: Docker with the compose plugin, and `VPS_USER` must be in
    the `docker` group and own `/opt/edge` and each `/opt/worktime3*` directory (one
    `sudo chown -R "$USER": /opt/edge /opt/worktime3*` after the first manual setup, or
    after anything root created them). DNS A records for the three hostnames and the
    Portainer hostname (`portainer` plus `TOOLS_SUFFIX`) and, if set, `MAIL_SUB`, must point at the
    server. Each instance's Postgres port is reachable from anywhere unless the server
    firewall limits it: allow only your own IPs. Connect with a normal client to
    `VPS_HOST:<PG_PORT>` as role `worktime`, database `worktime`, with that
    environment's `POSTGRES_PASSWORD`. Create the Portainer admin right after its first start: it locks itself
    after 5 minutes without one.
  - **`azure`** environment. Same names as `azure.yml` lists
    (`AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID`, `POSTGRES_PASSWORD`, …).
    Environment values override repo-level ones, so existing repo secrets keep
    working until you move them.

To cut a release, push a `v*` tag (`git tag v1.2.0 && git push origin v1.2.0`).
`build-push` then publishes images tagged `v1.2.0`, without moving `latest`;
deploy them by passing that as `image_tag`. Every image also records its nearest
tag (`git describe`, so `v1.2.0-3-g97d21cd` for a later commit on main), commit
and commit date, which the app shows under the user menu's **Information**
(web and API separately, since they are deployed as separate images). Images
built before any tag exists show as untagged; host builds as local.

### Azure Container Apps

The apps run as Container Apps in a VNet-integrated environment:
`worktime3-auth` (Keycloak), `worktime3-api`, `worktime3-web`, plus the
`worktime3-migrate` and `worktime3-seed` jobs. Postgres is an Azure Database
for PostgreSQL Flexible Server (Burstable B1ms, private access in the same
VNet, TLS required, `citext`/`uuid-ossp` allowlisted via `azure.extensions`). `build-push` publishes the extra
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
| `deepfreeze` | Stops the apps, dumps the database to the `db-dumps` blob container, then deletes the Postgres server and its DNS zone. The server is kept if the dump fails. |
| `deepunfreeze` | Recreates the server, restores the newest dump, starts the apps. |
| `dropdb` | Stops the apps and deletes the server with no dump. All data is lost; you must type the server name in `confirm`. |
| `initdb` | Creates an empty server, runs migrations, starts the apps. Refuses if a server exists. The `seed` checkbox also loads the demo data. |
| `seed` | Loads the demo data, fresh database only. |
| `apps` | Re-applies the app specs after a config or secret change. |
| `adminer` | Creates or updates the Adminer database UI. The first run must be from a laptop, because it creates the Entra registration. |

`base` and `github` have no workflow: they need more rights than the deploy
identity has. `azure-deploy` needs a running database, so unfreeze first.

Adminer is the way into the private database: `worktime3-adminer` runs inside
the environment, scales to zero, and stops and starts with the other apps. It
asks for three logins: Microsoft sign-in (tenant accounts only), the browser
prompt (`admin`, same password as the VPS), then Adminer's own. In Adminer
choose PostgreSQL and log in as `worktime` with `POSTGRES_PASSWORD`.
