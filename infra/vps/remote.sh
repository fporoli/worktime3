#!/usr/bin/env bash
# Runs ON the VPS. Shipped from the repo by .github/workflows/vps.yml, which also supplies
# the secrets and variables of the chosen GitHub Environment as environment variables.
# Nothing on the server is edited by hand and there is no git checkout there.
#
#   remote.sh deploy        edge stack (Caddy, Mailpit, Portainer), then this instance
#                           (own Postgres, migrate, api, web, Keycloak), then reload Caddy
#   remote.sh reset-seed    backs up and drops the public schema, migrates, loads the demo data
#   remote.sh destroy       removes this instance entirely (a final dump is kept in $HOME)
#
# One GitHub Environment = one instance. Everything instance-specific derives from its name
# (ENVIRONMENT), its hostnames (DOMAIN + WEB_SUB/API_SUB/AUTH_SUB) and its Postgres port
# (PG_PORT), so several instances (production, preprod, test, ...) can share a server: each
# gets its own containers, Compose project, directory, Postgres and Caddy site. The
# environment named `vps` is production and keeps the original container and directory
# names; any other name, e.g. `preprod`, gets suffixed ones.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # the files just shipped
EDGE=/opt/edge

slug="$(printf '%s' "${ENVIRONMENT:?required}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | sed 's/-*$//')"
if [ "$slug" = vps ]; then
  PREFIX=worktime3 LEGACY_DB=worktime
else
  PREFIX="worktime3-$slug" LEGACY_DB="worktime_${slug//-/_}"
fi
ROOT="/opt/$PREFIX"
PG="$PREFIX-pg"
WEB_HOST="${WEB_SUB:?required}.${DOMAIN:?required}"
API_HOST="${API_SUB:?required}.$DOMAIN"
AUTH_HOST="${AUTH_SUB:?required}.$DOMAIN"
: "${PG_PORT:?required}"
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
    PG_PORT WEB_HOST API_HOST AUTH_HOST
  (
    umask 077
    for name in POSTGRES_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD API_JWT_SECRET \
      SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_PASSWORD SMTP_SECURE SHOW_DEMO_ACCOUNTS \
      REALM_FILE CONTAINER_PREFIX PG_PORT WEB_HOST API_HOST AUTH_HOST; do
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
  for site in mail portainer; do
    sed -E -e "s/^(mail|portainer)\.turbotapir\.com/\1${TOOLS_SUFFIX:-}.turbotapir.com/" \
      -e "s/turbotapir\.com/$DOMAIN/g" "$ROOT/infra/caddy/edge/sites/$site.caddy" > "$EDGE/sites/$site.caddy"
  done
  rm -f "$EDGE/sites/db.caddy"      # Adminer is gone
  docker rm -f edge-adminer >/dev/null 2>&1 || true
  sed -e "s/__WEB_HOST__/$WEB_HOST/g" -e "s/__API_HOST__/$API_HOST/g" \
      -e "s/__AUTH_HOST__/$AUTH_HOST/g" -e "s/__PREFIX__/$PREFIX/g" \
    "$ROOT/infra/caddy/edge/sites/worktime3.caddy.tpl" > "$EDGE/sites/$PREFIX.caddy"
  (
    umask 077
    printf "DOMAIN='%s'\nTOOLS_SUFFIX='%s'\n" "$DOMAIN" "${TOOLS_SUFFIX:-}" > "$EDGE/.env"
  )
  # No --remove-orphans: the legacy shared `edge-pg` (see migrate_legacy) must stay up until
  # you have checked the migrated data and removed it yourself.
  (cd "$EDGE" && docker compose up -d)
}

# Starts this instance's Postgres and waits until it accepts connections.
pg_up() {
  "${COMPOSE[@]}" up -d pg
  local i
  for i in $(seq 1 60); do
    docker exec "$PG" pg_isready -U worktime -d worktime >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "$PG did not become ready" >&2
  exit 1
}

# One-time move from the old shared Postgres (`edge-pg`, one database per instance) into this
# instance's own Postgres. Runs only when edge-pg still has this instance's legacy database
# and the new Postgres has no tables yet. Non-destructive: the legacy database is left in
# place, and a dump stays in $ROOT. The api and Keycloak are stopped first so no write is lost.
migrate_legacy() {
  docker inspect edge-pg >/dev/null 2>&1 || return 0
  [ "$(docker exec edge-pg psql -U postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$LEGACY_DB'")" = 1 ] || return 0
  local has
  has="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public', 'auth')")"
  [ "$has" = 0 ] || return 0

  echo "Moving database $LEGACY_DB from edge-pg into $PG"
  docker stop "$PREFIX-api" "$PREFIX-keycloak" >/dev/null 2>&1 || true
  local dump q before after
  dump="$ROOT/legacy-$LEGACY_DB-$(date -u +%Y%m%dT%H%M%SZ).dump"
  docker exec edge-pg pg_dump -U postgres -d "$LEGACY_DB" --format=custom > "$dump"
  test -s "$dump"
  # --no-owner: everything ends up owned by this instance's `worktime` role. Harmless
  # notices (e.g. "schema public already exists") are expected, so success is judged below.
  docker exec -i "$PG" pg_restore -U worktime -d worktime --no-owner --no-privileges < "$dump" || true

  q="SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public', 'auth')"
  before="$(docker exec edge-pg psql -U postgres -d "$LEGACY_DB" -Atqc "$q")"
  after="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "$q")"
  if [ "$before" != "$after" ] || [ "$after" = 0 ]; then
    echo "Move failed: $before tables in edge-pg/$LEGACY_DB, $after in $PG. The old database is untouched; dump: $dump" >&2
    exit 1
  fi
  echo "Moved $after tables. Dump kept at $dump. After checking the site you can remove the old server: docker rm -f edge-pg"
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
  pg_up
  migrate_legacy
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
  docker inspect "$PG" >/dev/null
  docker inspect "$PREFIX-api" >/dev/null

  local auth_tables_before backup_dir timestamp backup_file seed_file counts
  auth_tables_before="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth'")"
  test "$auth_tables_before" -gt 0

  backup_dir="$HOME/$PREFIX-db-backups"
  mkdir -p "$backup_dir"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="$backup_dir/public-before-reset-$timestamp.dump"
  docker exec "$PG" pg_dump -U worktime -d worktime --schema=public --format=custom > "$backup_file"
  test -s "$backup_file"
  echo "Public-schema backup saved to $backup_file"

  docker stop "$PREFIX-api"
  docker exec "$PG" psql -U worktime -d worktime -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION worktime; GRANT ALL ON SCHEMA public TO public;"

  "${COMPOSE[@]}" run --rm --build --no-deps migrate

  seed_file="/tmp/$PREFIX-seed-$timestamp.sql"
  docker cp "$ROOT/infra/postgres/seeds/seed.sql" "$PG:$seed_file"
  docker exec "$PG" psql -U worktime -d worktime --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction -f "$seed_file"
  docker exec "$PG" rm -f "$seed_file"

  counts="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.organizations), (SELECT count(*) FROM public.user_identities WHERE provider = 'password'), (SELECT count(*) FROM public.databasechangelog), (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth')")"
  test "$counts" = "8|2|3|62|$auth_tables_before"
  echo "Verified users|organizations|password identities|changesets|auth tables: $counts"

  docker start "$PREFIX-api"
}

# Removes this instance: containers, its Postgres and volume, /opt/<prefix>, its Caddy site,
# and its legacy database/role on the old shared edge-pg if that still has them (otherwise the
# next deploy would copy the old data back). A final dump of whatever existed is left in $HOME.
# The shared edge stack (Caddy, Mailpit, Portainer) and other instances are not touched.
destroy() {
  local ts n legacy=0
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  if docker inspect "$PG" >/dev/null 2>&1; then
    docker exec "$PG" pg_dump -U worktime -d worktime --format=custom > "$HOME/$PREFIX-final-$ts.dump"
    test -s "$HOME/$PREFIX-final-$ts.dump"
    echo "Final dump saved to $HOME/$PREFIX-final-$ts.dump"
  fi
  if docker inspect edge-pg >/dev/null 2>&1 &&
     [ "$(docker exec edge-pg psql -U postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$LEGACY_DB'")" = 1 ]; then
    legacy=1
    docker exec edge-pg pg_dump -U postgres -d "$LEGACY_DB" --format=custom > "$HOME/$PREFIX-legacy-final-$ts.dump"
    test -s "$HOME/$PREFIX-legacy-final-$ts.dump"
    echo "Legacy dump saved to $HOME/$PREFIX-legacy-final-$ts.dump"
  fi

  [ -f "$ROOT/compose/docker-compose.vps.yml" ] && "${COMPOSE[@]}" down -v --remove-orphans || true
  for n in web api keycloak pg; do docker rm -f "$PREFIX-$n" >/dev/null 2>&1 || true; done
  docker volume rm "${PREFIX}_pg_data" >/dev/null 2>&1 || true
  if [ "$legacy" = 1 ]; then
    docker exec edge-pg psql -U postgres -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$LEGACY_DB\" WITH (FORCE)" -c "DROP ROLE IF EXISTS \"$LEGACY_DB\""
  fi
  rm -f "$EDGE/sites/$PREFIX.caddy"
  rm -rf "$ROOT"
  if docker inspect edge-caddy >/dev/null 2>&1; then caddy_reload; fi
  echo "Instance $PREFIX removed."
}

case "${1:-}" in
  destroy) destroy ;;
  deploy) deploy ;;
  reset-seed) reset_seed ;;
  *) echo "usage: remote.sh deploy|reset-seed|destroy" >&2; exit 2 ;;
esac
