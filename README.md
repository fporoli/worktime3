# worktime3

Enterprise + individual time tracking. NestJS API, React+MUI web, Postgres, Keycloak (same DB, `auth` schema), Caddy.

## Ports (8090+N keycloak, 5430+N pg, 3000+N web, 8000+N api)

| Env | N | pg | keycloak | web | api |
|---|---|----|----------|-----|-----|
| local dev (pg+kc in containers, api+web local) | 1 | 5431 | 8091 | 3001 | 8001 |
| docker dev (all dockerized) | 2 | 5432 | 8092 | 3002 | 8002 |
| VPS | 3 | 5433 | 8093 | 3003 | 8003 |
| Azure | 4 | 5434 | 8094 | 3004 | 8004 |

## Local dev

```sh
cp .env.example .env
docker compose -f compose/docker-compose.local.yml up -d
psql $DATABASE_URL -f schema.sql -f infra/postgres/migrations/002-worktime-extensions.sql
psql $DATABASE_URL -f infra/postgres/seeds/seed.dev.sql
npm install
npm run build --workspaces
npm run test --workspaces
```

## Roles

- `user`: log own work time, daily/weekly/monthly overview.
- `manager`: + invite, assign roles, teams, subprojects (only if project owner).
- `admin`: + static data, audit read, projects, SSO/domains override.

## Auth

Keycloak realm `worktime` (see `infra/keycloak/realm-worktime.json`).
Self-onboarding + password reset: `POST /api/v1/auth/onboard`, `POST /api/v1/auth/reset-password`.
Azure link/unlink: `POST /api/v1/auth/azure/link`, `DELETE /api/v1/auth/azure/link/:userId`.

## Deploy

- VPS/Azure workflows are manual (`workflow_dispatch`) and need secrets:
  `VPS_HOST/VPS_USER/VPS_SSH_KEY`, `AZURE_CREDENTIALS`.
- GitHub Pages deploys `docs/` automatically on push to main (docs only, not the app).
