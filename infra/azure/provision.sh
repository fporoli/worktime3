#!/usr/bin/env bash
# Provisions worktime3 on Azure Container Apps, with Postgres on a private Azure Database
# for PostgreSQL Flexible Server (Burstable B1ms), in the tenant and subscription configured
# in infra/azure/.env.azure (copy env.example.azure.cfg).
# Every phase is safe to re-run: resources are created when missing, updated otherwise.
#
#   provision.sh base     resource group, VNet, Postgres server, storage, Container Apps
#                         environment; prints the hostnames and the GitHub variables to set
#   provision.sh apps     migrate job (and runs it), keycloak, api, web
#   provision.sh seed     loads infra/postgres/seeds/seed.sql (fresh database only)
#   provision.sh github   identity that .github/workflows/deploy-azure.yml logs in with
#
# Needs: az CLI (logged in: az login --tenant <id>), node, bash (Git Bash on Windows).
set -euo pipefail
# Git Bash would otherwise rewrite slash-leading arguments ("/subscriptions/...",
# "/account/share") into Windows paths before az sees them.
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CONFIG="$HERE/.env.azure"
RENDER="$HERE/.rendered"

[ -f "$CONFIG" ] || { echo "Missing $CONFIG: copy env.example.azure.cfg to .env.azure and fill it in." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < "$CONFIG")
set +a

ENV_NAME=worktime3-env
VNET=worktime3-vnet
SUBNET=aca
PG_SUBNET=postgres
PG_HOST="${PG_SERVER_NAME:-}.postgres.database.azure.com"
AUTH_APP=worktime3-auth
API_APP=worktime3-api
WEB_APP=worktime3-web
MIGRATE_JOB=worktime3-migrate
SEED_JOB=worktime3-seed

# az on Windows prints CRLF, which would end up inside every captured value.
tsv() { az "$@" -o tsv | tr -d '\r'; }
# az is a Windows program there too, so it needs Windows paths for files we hand it.
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
require() {
  for v in "$@"; do
    [ -n "${!v:-}" ] || { echo "Set $v in $CONFIG" >&2; exit 1; }
  done
}

login_check() {
  require AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID LOCATION RESOURCE_GROUP
  az account set --subscription "$AZURE_SUBSCRIPTION_ID"
  local tenant
  tenant="$(tsv account show --query tenantId)"
  [ "$tenant" = "$AZURE_TENANT_ID" ] || {
    echo "Logged into tenant $tenant, expected $AZURE_TENANT_ID: az login --tenant $AZURE_TENANT_ID" >&2
    exit 1
  }
}

env_domain() { tsv containerapp env show -g "$RESOURCE_GROUP" -n "$ENV_NAME" --query properties.defaultDomain; }

base() {
  require PG_SERVER_NAME POSTGRES_PASSWORD DOCS_STORAGE_ACCOUNT
  az extension add --name containerapp --upgrade --only-show-errors
  for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.Storage Microsoft.Network Microsoft.DBforPostgreSQL; do
    az provider register --namespace "$ns" --wait -o none
  done
  az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

  # One VNet for the apps and a private Postgres server, so the database has no public
  # endpoint at all. Each subnet is delegated to the service that lives in it.
  if ! az network vnet show -g "$RESOURCE_GROUP" -n "$VNET" -o none 2>/dev/null; then
    az network vnet create -g "$RESOURCE_GROUP" -n "$VNET" -l "$LOCATION" --address-prefixes 10.40.0.0/16 -o none
  fi
  if ! az network vnet subnet show -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$SUBNET" -o none 2>/dev/null; then
    az network vnet subnet create -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$SUBNET" \
      --address-prefixes 10.40.0.0/23 --delegations Microsoft.App/environments -o none
  fi
  if ! az network vnet subnet show -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$PG_SUBNET" -o none 2>/dev/null; then
    az network vnet subnet create -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$PG_SUBNET" \
      --address-prefixes 10.40.2.0/28 --delegations Microsoft.DBforPostgreSQL/flexibleServers -o none
  fi
  local subnet_id pg_subnet_id
  subnet_id="$(tsv network vnet subnet show -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$SUBNET" --query id)"
  pg_subnet_id="$(tsv network vnet subnet show -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$PG_SUBNET" --query id)"

  # Private access: the zone linked to the VNet is what lets apps in the environment
  # resolve $PG_HOST to the server's private IP.
  local pg_zone="$PG_SERVER_NAME.private.postgres.database.azure.com" pg_zone_id
  if ! az network private-dns zone show -g "$RESOURCE_GROUP" -n "$pg_zone" -o none 2>/dev/null; then
    az network private-dns zone create -g "$RESOURCE_GROUP" -n "$pg_zone" -o none
  fi
  if ! az network private-dns link vnet show -g "$RESOURCE_GROUP" -z "$pg_zone" -n "$VNET" -o none 2>/dev/null; then
    az network private-dns link vnet create -g "$RESOURCE_GROUP" -z "$pg_zone" -n "$VNET" \
      --virtual-network "$VNET" --registration-enabled false -o none
  fi
  pg_zone_id="$(tsv network private-dns zone show -g "$RESOURCE_GROUP" -n "$pg_zone" --query id)"

  # Takes several minutes.
  if ! az postgres flexible-server show -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" -o none 2>/dev/null; then
    az postgres flexible-server create -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" -l "$LOCATION" \
      --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
      --admin-user worktime --admin-password "$POSTGRES_PASSWORD" \
      --subnet "$pg_subnet_id" --private-dns-zone "$pg_zone_id" \
      --yes -o none
  fi
  if ! az postgres flexible-server db show -g "$RESOURCE_GROUP" --server-name "$PG_SERVER_NAME" -n worktime -o none 2>/dev/null; then
    az postgres flexible-server db create -g "$RESOURCE_GROUP" --server-name "$PG_SERVER_NAME" -n worktime -o none
  fi
  # Flexible Server only allows extensions on this list; 001-initial-schema.sql creates both.
  az postgres flexible-server parameter set -g "$RESOURCE_GROUP" --server-name "$PG_SERVER_NAME" \
    --name azure.extensions --value CITEXT,UUID-OSSP -o none

  # Uploaded documents (DOCUMENTS_DIR): plain files, so cheap standard SMB is fine.
  if ! az storage account show -g "$RESOURCE_GROUP" -n "$DOCS_STORAGE_ACCOUNT" -o none 2>/dev/null; then
    az storage account create -g "$RESOURCE_GROUP" -n "$DOCS_STORAGE_ACCOUNT" -l "$LOCATION" \
      --kind StorageV2 --sku Standard_LRS --min-tls-version TLS1_2 -o none
  fi
  if ! az storage share-rm show -g "$RESOURCE_GROUP" --storage-account "$DOCS_STORAGE_ACCOUNT" -n documents -o none 2>/dev/null; then
    az storage share-rm create -g "$RESOURCE_GROUP" --storage-account "$DOCS_STORAGE_ACCOUNT" -n documents --quota 10 -o none
  fi

  if ! az containerapp env show -g "$RESOURCE_GROUP" -n "$ENV_NAME" -o none 2>/dev/null; then
    az containerapp env create -g "$RESOURCE_GROUP" -n "$ENV_NAME" -l "$LOCATION" \
      --infrastructure-subnet-resource-id "$subnet_id" --enable-workload-profiles -o none
  fi
  local docs_key
  docs_key="$(tsv storage account keys list -g "$RESOURCE_GROUP" -n "$DOCS_STORAGE_ACCOUNT" --query '[0].value')"
  az containerapp env storage set -g "$RESOURCE_GROUP" -n "$ENV_NAME" --storage-name documents \
    --storage-type AzureFile --azure-file-account-name "$DOCS_STORAGE_ACCOUNT" \
    --azure-file-account-key "$docs_key" --azure-file-share-name documents --access-mode ReadWrite -o none

  local domain
  domain="$(env_domain)"
  cat <<EOF

Environment ready. The apps will live at:
  web       https://$WEB_APP.$domain
  api       https://$API_APP.$domain/api/v1
  keycloak  https://$AUTH_APP.$domain

Next, give build-push the Azure hostnames for the web-azure image and build all images:
  gh variable set AZURE_API_URL --body "https://$API_APP.$domain/api/v1"
  gh variable set AZURE_KEYCLOAK_URL --body "https://$AUTH_APP.$domain"
  gh variable set AZURE_RESOURCE_GROUP --body "$RESOURCE_GROUP"
  gh workflow run build-push.yml --ref main
Then: infra/azure/provision.sh apps
EOF
}

# Creates the app (or job) from a rendered spec, or updates it in place.
upsert() {
  local kind="$1" name="$2" spec
  spec="$(winpath "$3")"
  if [ "$kind" = job ]; then
    if az containerapp job show -g "$RESOURCE_GROUP" -n "$name" -o none 2>/dev/null; then
      az containerapp job update -g "$RESOURCE_GROUP" -n "$name" --yaml "$spec" -o none
    else
      az containerapp job create -g "$RESOURCE_GROUP" -n "$name" --yaml "$spec" -o none
    fi
  elif az containerapp show -g "$RESOURCE_GROUP" -n "$name" -o none 2>/dev/null; then
    az containerapp update -g "$RESOURCE_GROUP" -n "$name" --yaml "$spec" -o none
  else
    az containerapp create -g "$RESOURCE_GROUP" -n "$name" --yaml "$spec" -o none
  fi
  echo "  $name ok"
}

run_job() {
  local job="$1" execution status
  execution="$(tsv containerapp job start -g "$RESOURCE_GROUP" -n "$job" --query name)"
  echo "  $job running ($execution)"
  while :; do
    status="$(tsv containerapp job execution show -g "$RESOURCE_GROUP" -n "$job" --job-execution-name "$execution" --query properties.status)"
    case "$status" in
      Succeeded) echo "  $job succeeded"; return 0 ;;
      Failed|Stopped|Degraded)
        echo "$job execution $execution ended $status; see its logs under the job's Execution history in the portal." >&2
        return 1 ;;
    esac
    sleep 10
  done
}

# Values shared by every spec. Secrets go into the rendered files, which are deleted on exit.
prepare_specs() {
  require GITHUB_REPOSITORY GHCR_USERNAME GHCR_TOKEN IMAGE_TAG PG_SERVER_NAME POSTGRES_PASSWORD
  ENV_ID="$(tsv containerapp env show -g "$RESOURCE_GROUP" -n "$ENV_NAME" --query id)"
  DOMAIN="$(env_domain)"
  IMAGES="ghcr.io/${GITHUB_REPOSITORY,,}"
  WEB_URL="https://$WEB_APP.$DOMAIN"
  AUTH_URL="https://$AUTH_APP.$DOMAIN"
  mkdir -p "$RENDER"
  trap 'rm -rf "$RENDER"' EXIT
}

# Header for every app/job spec: environment, pull secret for the private GHCR images.
spec_head() {
  cat <<EOF
location: $LOCATION
properties:
  environmentId: $ENV_ID
  workloadProfileName: Consumption
  configuration:
    registries:
      - server: ghcr.io
        username: "$GHCR_USERNAME"
        passwordSecretRef: ghcr-token
EOF
}

apps() {
  require KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD API_JWT_SECRET
  prepare_specs

  # Flexible Server refuses unencrypted connections, so every client below asks for TLS.
  # Liquibase takes the connection from LIQUIBASE_COMMAND_* so the password stays a secret.
  { spec_head; cat <<EOF
    triggerType: Manual
    replicaTimeout: 1800
    replicaRetryLimit: 0
    manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
    secrets:
      - name: ghcr-token
        value: "$GHCR_TOKEN"
      - name: pg-password
        value: "$POSTGRES_PASSWORD"
  template:
    containers:
      - name: migrate
        image: $IMAGES/migrate:$IMAGE_TAG
        resources: { cpu: 0.5, memory: 1Gi }
        args: ["--changelog-file=db.changelog-master.xml", "update"]
        env:
          - { name: LIQUIBASE_COMMAND_URL, value: "jdbc:postgresql://$PG_HOST:5432/worktime?sslmode=require" }
          - { name: LIQUIBASE_COMMAND_USERNAME, value: worktime }
          - { name: LIQUIBASE_COMMAND_PASSWORD, secretRef: pg-password }
EOF
  } > "$RENDER/migrate.yaml"
  upsert job "$MIGRATE_JOB" "$RENDER/migrate.yaml"
  run_job "$MIGRATE_JOB"

  # The realm file goes in as a secret volume (nothing else can carry a repo file into the
  # app), with the Azure web URL added to the worktime-web client's redirects and origins.
  local realm_json
  realm_json="$(WEB_URL="$WEB_URL" node -e '
    const fs = require("fs");
    const realm = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const client = realm.clients.find((c) => c.clientId === "worktime-web");
    const url = process.env.WEB_URL;
    if (!client.redirectUris.includes(url + "/*")) client.redirectUris.push(url + "/*");
    if (!client.webOrigins.includes(url)) client.webOrigins.push(url);
    // A JSON string literal is also a valid YAML double-quoted scalar.
    process.stdout.write(JSON.stringify(JSON.stringify(realm)));
  ' "$(winpath "$REPO/infra/keycloak/realm-worktime.json")")"

  { spec_head; cat <<EOF
    activeRevisionsMode: Single
    secrets:
      - name: ghcr-token
        value: "$GHCR_TOKEN"
      - name: pg-password
        value: "$POSTGRES_PASSWORD"
      - name: kc-admin-password
        value: "$KEYCLOAK_ADMIN_PASSWORD"
      - name: realm-json
        value: $realm_json
    ingress: { external: true, targetPort: 8080, transport: auto }
  template:
    containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:25.0
        args: ["start", "--import-realm"]
        resources: { cpu: 1, memory: 2Gi }
        env:
          - { name: KC_DB, value: postgres }
          - { name: KC_DB_URL, value: "jdbc:postgresql://$PG_HOST:5432/worktime?currentSchema=auth&sslmode=require" }
          - { name: KC_DB_USERNAME, value: worktime }
          - { name: KC_DB_PASSWORD, secretRef: pg-password }
          - { name: KEYCLOAK_ADMIN, value: "$KEYCLOAK_ADMIN" }
          - { name: KEYCLOAK_ADMIN_PASSWORD, secretRef: kc-admin-password }
          # Container Apps ingress terminates TLS and forwards plain HTTP (see docker-compose.vps.yml).
          - { name: KC_HOSTNAME, value: "$AUTH_URL" }
          - { name: KC_HTTP_ENABLED, value: "true" }
          - { name: KC_PROXY_HEADERS, value: xforwarded }
        volumeMounts:
          - { volumeName: realm, mountPath: /opt/keycloak/data/import }
    scale: { minReplicas: 1, maxReplicas: 1 }
    volumes:
      - name: realm
        storageType: Secret
        secrets:
          - { secretRef: realm-json, path: realm-worktime.json }
EOF
  } > "$RENDER/keycloak.yaml"
  upsert app "$AUTH_APP" "$RENDER/keycloak.yaml"

  # Container Apps rejects empty secrets, so the SMTP password is only wired when set.
  local smtp_secret="" smtp_env=""
  if [ -n "${SMTP_PASSWORD:-}" ]; then
    smtp_secret="      - name: smtp-password
        value: \"$SMTP_PASSWORD\""
    smtp_env="          - { name: SMTP_PASSWORD, secretRef: smtp-password }"
  fi
  { spec_head; cat <<EOF
    activeRevisionsMode: Single
    secrets:
      - name: ghcr-token
        value: "$GHCR_TOKEN"
      - name: database-url
        value: "postgresql://worktime:$POSTGRES_PASSWORD@$PG_HOST:5432/worktime?sslmode=verify-full"
      - name: api-jwt-secret
        value: "$API_JWT_SECRET"
$smtp_secret
    ingress: { external: true, targetPort: 8000, transport: auto }
  template:
    containers:
      - name: api
        image: $IMAGES/api:$IMAGE_TAG
        resources: { cpu: 0.5, memory: 1Gi }
        env:
          - { name: NODE_ENV, value: production }
          - { name: API_PORT, value: "8000" }
          - { name: DATABASE_URL, secretRef: database-url }
          - { name: API_JWT_SECRET, secretRef: api-jwt-secret }
          - { name: JWT_ISSUER, value: "$AUTH_URL/realms/worktime" }
          - { name: JWT_AUDIENCE, value: worktime-web }
          - { name: APP_BASE_URL, value: "$WEB_URL" }
          - { name: DOCUMENTS_DIR, value: /data/documents }
          - { name: SMTP_HOST, value: "${SMTP_HOST:-}" }
          - { name: SMTP_PORT, value: "${SMTP_PORT:-587}" }
          - { name: SMTP_FROM, value: "${SMTP_FROM:-worktime@localhost}" }
          - { name: SMTP_USER, value: "${SMTP_USER:-}" }
          - { name: SMTP_SECURE, value: "${SMTP_SECURE:-false}" }
$smtp_env
        volumeMounts:
          - { volumeName: documents, mountPath: /data/documents }
    # One replica: the notifications WebSocket gateway only reaches sockets in its own process.
    scale: { minReplicas: 1, maxReplicas: 1 }
    volumes:
      - { name: documents, storageType: AzureFile, storageName: documents }
EOF
  } > "$RENDER/api.yaml"
  upsert app "$API_APP" "$RENDER/api.yaml"

  { spec_head; cat <<EOF
    activeRevisionsMode: Single
    secrets:
      - name: ghcr-token
        value: "$GHCR_TOKEN"
    ingress: { external: true, targetPort: 80, transport: auto }
  template:
    containers:
      - name: web
        image: $IMAGES/web-azure:$IMAGE_TAG
        resources: { cpu: 0.25, memory: 0.5Gi }
    # Static nginx: fine to scale to zero, it starts in seconds.
    scale: { minReplicas: 0, maxReplicas: 1 }
EOF
  } > "$RENDER/web.yaml"
  upsert app "$WEB_APP" "$RENDER/web.yaml"

  cat <<EOF

Deployed. Open $WEB_URL
Keycloak admin: $AUTH_URL/admin (user $KEYCLOAK_ADMIN)
Demo data: infra/azure/provision.sh seed
EOF
}

seed() {
  prepare_specs
  { spec_head; cat <<EOF
    triggerType: Manual
    replicaTimeout: 600
    replicaRetryLimit: 0
    manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
    secrets:
      - name: ghcr-token
        value: "$GHCR_TOKEN"
      - name: pg-password
        value: "$POSTGRES_PASSWORD"
  template:
    containers:
      - name: seed
        image: $IMAGES/seed:$IMAGE_TAG
        resources: { cpu: 0.25, memory: 0.5Gi }
        env:
          - { name: PGHOST, value: $PG_HOST }
          - { name: PGSSLMODE, value: require }
          - { name: PGPORT, value: "5432" }
          - { name: PGDATABASE, value: worktime }
          - { name: PGUSER, value: worktime }
          - { name: PGPASSWORD, secretRef: pg-password }
EOF
  } > "$RENDER/seed.yaml"
  upsert job "$SEED_JOB" "$RENDER/seed.yaml"
  run_job "$SEED_JOB"
}

# Entra app + federated credential: GitHub Actions on main exchanges its OIDC token for
# an Azure token, so no client secret is stored anywhere. Contributor on the group only.
github() {
  require GITHUB_REPOSITORY
  local name=worktime3-github-deploy app_id rg_id
  app_id="$(tsv ad app list --display-name "$name" --query '[0].appId')"
  [ -n "$app_id" ] || app_id="$(tsv ad app create --display-name "$name" --query appId)"
  az ad sp show --id "$app_id" -o none 2>/dev/null || az ad sp create --id "$app_id" -o none
  if ! tsv ad app federated-credential list --id "$app_id" --query '[].name' | grep -qx main; then
    az ad app federated-credential create --id "$app_id" -o none --parameters \
      "{\"name\":\"main\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:$GITHUB_REPOSITORY:ref:refs/heads/main\",\"audiences\":[\"api://AzureADTokenExchange\"]}"
  fi
  rg_id="$(tsv group show -n "$RESOURCE_GROUP" --query id)"
  if [ -z "$(tsv role assignment list --assignee "$app_id" --role Contributor --scope "$rg_id" --query '[0].id')" ]; then
    # A fresh service principal takes a moment to become visible to role assignments.
    for attempt in 1 2 3 4 5 6; do
      az role assignment create --assignee "$app_id" --role Contributor --scope "$rg_id" -o none && break
      [ "$attempt" = 6 ] && exit 1
      sleep 10
    done
  fi
  cat <<EOF

Deploy identity ready. Store it for .github/workflows/deploy-azure.yml:
  gh secret set AZURE_CLIENT_ID --body "$app_id"
  gh secret set AZURE_TENANT_ID --body "$AZURE_TENANT_ID"
  gh secret set AZURE_SUBSCRIPTION_ID --body "$AZURE_SUBSCRIPTION_ID"
EOF
}

case "${1:-}" in
  base|apps|seed|github) login_check; "$1" ;;
  *) echo "Usage: $0 base|apps|seed|github" >&2; exit 1 ;;
esac
