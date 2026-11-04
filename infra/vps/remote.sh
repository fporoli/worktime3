#!/usr/bin/env bash
# Runs ON the VPS. Shipped from the repo by .github/workflows/vps.yml, which also supplies
# the secrets and variables of the chosen GitHub Environment as environment variables.
# Nothing on the server is edited by hand and there is no git checkout there.
#
#   remote.sh deploy        edge stack (Caddy, shared Postgres, Mailpit, Adminer, Portainer),
#                           then this instance (migrate, api, web, Keycloak), then reload Caddy
#   remote.sh reset-seed    backs up and drops the public schema, migrates, loads the demo data
#
# One GitHub Environment = one instance. Everything instance-specific derives from its name
# (ENVIRONMENT) and its hostnames (DOMAIN + WEB_SUB/API_SUB/AUTH_SUB), so several instances
# can share a server: each gets its own containers, project, directory, database and Caddy
# site. The environment named `vps` is production and keeps the original names, so moving to
# this scheme did not recreate it; any other name, e.g. `preproduction`, gets suffixed names.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # the files just shipped
EDGE=/opt/edge

slug="$(printf '%s' "${ENVIRONMENT:?required}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | sed 's/-*$//')"
if [ "$slug" = vps ]; then
  PREFIX=worktime3 DB_NAME=worktime
else
  PREFIX="worktime3-$slug" DB_NAME="worktime_${slug//-/_}"
fi
ROOT="/opt/$PREFIX"
WEB_HOST="${WEB_SUB:?required}.${DOMAIN:?required}"
API_HOST="${API_SUB:?required}.$DOMAIN"
AUTH_HOST="${AUTH_SUB:?required}.$DOMAIN"
COMPOSE=(docker compose -p "$PREFIX" -f "$ROOT/compose/docker-compose.vps.yml")

# Copies the shipped files into this instance's directory. compose/.env is left alone.
install_files() {
  mkdir -p "$ROOT/compose" "$ROOT/rendered"
  rm -rf "$ROOT/infra"
  cp -a "$SRC/infra" "$ROOT/infra"
  cp "$SRC/compose/docker-compose.vps.yml" "$ROOT/compose/docker-compose.vps.yml"
  # Keycloak redirect URIs follow this instance's web host.
  sed "s#https://wt\.turbotapir\.com#https://$WEB_HOST#g" \
    "$ROOT/infra/keycloak/realm-worktime.json" > "$ROOT/rendered/realm-worktime.json"
}

# Values are single-quoted so compose does not interpolate `$`; they must not contain a
# single quote. SMTP_* may be empty: the compose file falls back to the shared Mailpit.
write_app_env() {
  export REALM_FILE="$ROOT/rendered/realm-worktime.json" CONTAINER_PREFIX="$PREFIX" \
    DB_NAME WEB_HOST API_HOST AUTH_HOST
  (
    umask 077
    for name in POSTGRES_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD API_JWT_SECRET \
      SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_PASSWORD SMTP_SECURE SHOW_DEMO_ACCOUNTS \
      REALM_FILE CONTAINER_PREFIX DB_NAME WEB_HOST API_HOST AUTH_HOST; do
      printf "%s='%s'\n" "$name" "$(printenv "$name" || true)"
    done > "$ROOT/compose/.env"
  )
  export API_IMAGE="ghcr.io/$REPO/api:$IMAGE_TAG" WEB_IMAGE="ghcr.io/$REPO/web:$IMAGE_TAG"
}

edge_up() {
  docker network inspect edge >/dev/null 2>&1 || docker network create edge
  mkdir -p "$EDGE/sites"
  cp "$ROOT/infra/caddy/edge/docker-compose.yml" "$ROOT/infra/caddy/edge/Caddyfile" "$EDGE/"
  # Site files are rendered, not copied: the shared ones follow DOMAIN, this instance's own
  # one follows its three hostnames. Only files this run owns are replaced, so other
  # instances on the server keep theirs.
  for site in db mail portainer; do
    sed -E -e "s/^(db|mail|portainer)\.turbotapir\.com/\1${TOOLS_SUFFIX:-}.turbotapir.com/" \
      -e "s/turbotapir\.com/$DOMAIN/g" "$ROOT/infra/caddy/edge/sites/$site.caddy" > "$EDGE/sites/$site.caddy"
  done
  sed -e "s/__WEB_HOST__/$WEB_HOST/g" -e "s/__API_HOST__/$API_HOST/g" \
      -e "s/__AUTH_HOST__/$AUTH_HOST/g" -e "s/__PREFIX__/$PREFIX/g" \
    "$ROOT/infra/caddy/edge/sites/worktime3.caddy.tpl" > "$EDGE/sites/$PREFIX.caddy"
  (
    umask 077
    printf "EDGE_PG_ADMIN_PASSWORD='%s'\nDOMAIN='%s'\nTOOLS_SUFFIX='%s'\n" "$EDGE_PG_ADMIN_PASSWORD" "$DOMAIN" "${TOOLS_SUFFIX:-}" > "$EDGE/.env"
  )
  (cd "$EDGE" && docker compose up -d --remove-orphans)
}

# Each instance owns a role and a database of the same name on the shared Postgres.
ensure_database() {
  local i
  for i in $(seq 1 60); do
    docker exec edge-pg pg_isready -U postgres >/dev/null 2>&1 && break
    [ "$i" = 60 ] && { echo "edge-pg did not become ready" >&2; exit 1; }
    sleep 2
  done
  docker exec -i edge-pg psql -U postgres -v ON_ERROR_STOP=1 -v db="$DB_NAME" -v pw="$POSTGRES_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db', :'pw')
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'db', :'pw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'db')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
SQL
}

ghcr_login() {
  [ -z "${GHCR_TOKEN:-}" ] && return 0
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:?GHCR_USERNAME is required with GHCR_TOKEN}" --password-stdin
}

caddy_reload() {
  docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
  docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
}

deploy() {
  install_files
  write_app_env
  ghcr_login
  edge_up
  ensure_database
  # api/web are pre-built images (no `build:` context), so `--build` below only rebuilds
  # migrate's local Dockerfile; it never re-pulls api/web from GHCR. Without this explicit
  # pull, `up` reuses whatever is cached under the same tag and runs stale code.
  "${COMPOSE[@]}" pull api web
  "${COMPOSE[@]}" up -d --build --remove-orphans
  caddy_reload
}

reset_seed() {
  install_files
  write_app_env
  ghcr_login
  docker inspect edge-pg >/dev/null
  docker inspect "$PREFIX-api" >/dev/null

  local auth_tables_before backup_dir timestamp backup_file seed_file counts
  auth_tables_before="$(docker exec edge-pg psql -U postgres -d "$DB_NAME" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth'")"
  test "$auth_tables_before" -gt 0

  backup_dir="$HOME/$PREFIX-db-backups"
  mkdir -p "$backup_dir"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="$backup_dir/public-before-reset-$timestamp.dump"
  docker exec edge-pg pg_dump -U "$DB_NAME" -d "$DB_NAME" --schema=public --format=custom > "$backup_file"
  test -s "$backup_file"
  echo "Public-schema backup saved to $backup_file"

  docker stop "$PREFIX-api"
  docker exec edge-pg psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION \"$DB_NAME\"; GRANT ALL ON SCHEMA public TO public;"

  "${COMPOSE[@]}" run --rm --build --no-deps migrate

  seed_file="/tmp/$PREFIX-seed-$timestamp.sql"
  docker cp "$ROOT/infra/postgres/seeds/seed.sql" "edge-pg:$seed_file"
  docker exec edge-pg psql -U postgres -d "$DB_NAME" --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction -f "$seed_file"
  docker exec edge-pg rm -f "$seed_file"

  counts="$(docker exec edge-pg psql -U postgres -d "$DB_NAME" -Atqc "SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.organizations), (SELECT count(*) FROM public.user_identities WHERE provider = 'password'), (SELECT count(*) FROM public.databasechangelog), (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth')")"
  test "$counts" = "8|2|3|62|$auth_tables_before"
  echo "Verified users|organizations|password identities|changesets|auth tables: $counts"

  docker start "$PREFIX-api"
}

case "${1:-}" in
  deploy) deploy ;;
  reset-seed) reset_seed ;;
  *) echo "usage: remote.sh deploy|reset-seed" >&2; exit 2 ;;
esac
