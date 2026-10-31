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
#   provision.sh github   identity that .github/workflows/azure-deploy.yml logs in with
#   provision.sh secrets  copies .env.azure to the GitHub secrets and variables that the
#                         azure-* workflows read
#   provision.sh freeze   stops the apps and Postgres to save costs; nothing is deleted
#   provision.sh unfreeze starts them again
#   provision.sh deepfreeze    stops the apps, dumps the database to blob storage, then
#                              deletes the Postgres server
#   provision.sh deepunfreeze  recreates the server, restores the newest dump, starts the apps
#   provision.sh dropdb   stops the apps and deletes the Postgres server without a dump
#   provision.sh initdb   creates an empty server, runs migrations, starts the apps
#   provision.sh adminer  Adminer database UI behind Entra sign-in and a password prompt.
#                         The first run needs a laptop: it creates the Entra registration
#
# Needs: az CLI (logged in: az login --tenant <id>), node, bash (Git Bash on Windows).
# The azure-* GitHub workflows run the same phases, with the config in their environment.
set -euo pipefail
# Git Bash would otherwise rewrite slash-leading arguments ("/subscriptions/...",
# "/account/share") into Windows paths before az sees them.
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CONFIG="$HERE/.env.azure"
RENDER="$HERE/.rendered"

if [ -f "$CONFIG" ]; then
  set -a
  # shellcheck disable=SC1090
  . <(tr -d '\r' < "$CONFIG")
  set +a
elif [ -z "${GITHUB_ACTIONS:-}" ]; then
  echo "Missing $CONFIG: copy env.example.azure.cfg to .env.azure and fill it in." >&2
  exit 1
fi

ENV_NAME=worktime3-env
VNET=worktime3-vnet
SUBNET=aca
PG_SUBNET=postgres
PG_HOST="${PG_SERVER_NAME:-}.postgres.database.azure.com"
AUTH_APP=worktime3-auth
API_APP=worktime3-api
WEB_APP=worktime3-web
ADMINER_APP=worktime3-adminer
MIGRATE_JOB=worktime3-migrate
SEED_JOB=worktime3-seed
DB_JOB=worktime3-dbtools
DUMP_CONTAINER=db-dumps

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

ensure_postgres() {
  # Private access: the zone linked to the VNet is what lets apps in the environment
  # resolve $PG_HOST to the server's private IP.
  local pg_zone="$PG_SERVER_NAME.private.postgres.database.azure.com" pg_zone_id pg_subnet_id
  if ! az network private-dns zone show -g "$RESOURCE_GROUP" -n "$pg_zone" -o none 2>/dev/null; then
    az network private-dns zone create -g "$RESOURCE_GROUP" -n "$pg_zone" -o none
  fi
  if ! az network private-dns link vnet show -g "$RESOURCE_GROUP" -z "$pg_zone" -n "$VNET" -o none 2>/dev/null; then
    az network private-dns link vnet create -g "$RESOURCE_GROUP" -z "$pg_zone" -n "$VNET" \
      --virtual-network "$VNET" --registration-enabled false -o none
  fi
  pg_zone_id="$(tsv network private-dns zone show -g "$RESOURCE_GROUP" -n "$pg_zone" --query id)"
  pg_subnet_id="$(tsv network vnet subnet show -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$PG_SUBNET" --query id)"

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
}

# The DNS zone goes too: it is billed monthly and ensure_postgres recreates it.
delete_postgres() {
  local pg_zone="$PG_SERVER_NAME.private.postgres.database.azure.com"
  if pg_exists; then
    az postgres flexible-server delete -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" --yes -o none
  fi
  if az network private-dns link vnet show -g "$RESOURCE_GROUP" -z "$pg_zone" -n "$VNET" -o none 2>/dev/null; then
    az network private-dns link vnet delete -g "$RESOURCE_GROUP" -z "$pg_zone" -n "$VNET" --yes -o none
  fi
  if az network private-dns zone show -g "$RESOURCE_GROUP" -n "$pg_zone" -o none 2>/dev/null; then
    az network private-dns zone delete -g "$RESOURCE_GROUP" -n "$pg_zone" --yes -o none
  fi
  echo "  $PG_SERVER_NAME deleted"
}

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
  local subnet_id
  subnet_id="$(tsv network vnet subnet show -g "$RESOURCE_GROUP" --vnet-name "$VNET" -n "$SUBNET" --query id)"

  ensure_postgres

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
  gh workflow run build-push.yml --ref $(git -C "$REPO" branch --show-current)
Then, once it has finished: infra/azure/provision.sh apps
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
    ingress: { external: true, targetPort: 8080, transport: auto, allowInsecure: false }
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
    ingress: { external: true, targetPort: 8000, transport: auto, allowInsecure: false }
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
    ingress: { external: true, targetPort: 80, transport: auto, allowInsecure: false }
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

# Entra sign-in in front of the whole app. No client secret: Azure then signs in with ID
# tokens, so there is no credential to store, rotate or carry through app updates.
adminer_signin() {
  local name=worktime3-adminer app_id
  app_id="$(tsv ad app list --display-name "$name" --query '[0].appId')"
  [ -n "$app_id" ] || app_id="$(tsv ad app create --display-name "$name" --sign-in-audience AzureADMyOrg --query appId)"
  az ad app update --id "$app_id" --enable-id-token-issuance true \
    --web-redirect-uris "https://$ADMINER_APP.$DOMAIN/.auth/login/aad/callback" -o none
  az ad sp show --id "$app_id" -o none 2>/dev/null || az ad sp create --id "$app_id" -o none
  az containerapp auth microsoft update -g "$RESOURCE_GROUP" -n "$ADMINER_APP" --client-id "$app_id" \
    --issuer "https://login.microsoftonline.com/$AZURE_TENANT_ID/v2.0" --yes -o none
  az containerapp auth update -g "$RESOURCE_GROUP" -n "$ADMINER_APP" --enabled true \
    --action RedirectToLoginPage --redirect-provider azureactivedirectory --require-https true -o none
  echo "  $ADMINER_APP sign-in ok"
}

# Postgres has no public endpoint, so Adminer is the way in: it runs in the environment and
# only it is public. Caddy adds the same Basic Auth prompt as the VPS (sites/db.caddy) on
# 8081; Adminer stays on localhost. Requests reach Caddy only after Entra sign-in.
adminer() {
  require PG_SERVER_NAME ADMINER_PASSWORD_HASH
  prepare_specs
  # The deploy identity can't create the Entra registration, so a workflow must not be the
  # one to create this app, or it would come up without sign-in.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    local enabled
    enabled="$(tsv containerapp auth show -g "$RESOURCE_GROUP" -n "$ADMINER_APP" --query platform.enabled 2>/dev/null || true)"
    [ "${enabled,,}" = true ] || { echo "Run provision.sh adminer from a laptop first, to set up sign-in." >&2; exit 1; }
  fi

  local caddyfile
  caddyfile="$(printf ':8081 {\n  basic_auth {\n    admin %s\n  }\n  reverse_proxy localhost:8080\n}\n' "$ADMINER_PASSWORD_HASH" |
    node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0, "utf8")))')"
  { spec_head; cat <<EOF
    activeRevisionsMode: Single
    secrets:
      - name: ghcr-token
        value: "$GHCR_TOKEN"
      - name: caddyfile
        value: $caddyfile
    ingress: { external: true, targetPort: 8081, transport: auto, allowInsecure: false }
  template:
    containers:
      - name: adminer
        image: adminer:5
        resources: { cpu: 0.25, memory: 0.5Gi }
        env:
          - { name: ADMINER_DEFAULT_SERVER, value: "$PG_HOST" }
      - name: caddy
        image: caddy:2
        resources: { cpu: 0.25, memory: 0.5Gi }
        volumeMounts:
          - { volumeName: caddy-config, mountPath: /etc/caddy }
    scale: { minReplicas: 0, maxReplicas: 1 }
    volumes:
      - name: caddy-config
        storageType: Secret
        secrets:
          - { secretRef: caddyfile, path: Caddyfile }
EOF
  } > "$RENDER/adminer.yaml"
  upsert app "$ADMINER_APP" "$RENDER/adminer.yaml"
  [ -n "${GITHUB_ACTIONS:-}" ] || adminer_signin

  cat <<EOF

Adminer: https://$ADMINER_APP.$DOMAIN
Choose PostgreSQL, then log in as worktime with POSTGRES_PASSWORD. Needs Postgres running.
EOF
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

Deploy identity ready. Store it for .github/workflows/azure-deploy.yml:
  gh secret set AZURE_CLIENT_ID --body "$app_id"
  gh secret set AZURE_TENANT_ID --body "$AZURE_TENANT_ID"
  gh secret set AZURE_SUBSCRIPTION_ID --body "$AZURE_SUBSCRIPTION_ID"
Then give the azure-* workflows the rest of the config: infra/azure/provision.sh secrets
EOF
}

# gh reads each secret from stdin, so no value ends up on a command line. GitHub rejects
# empty values, which is also what leaves the optional SMTP settings unset.
secrets() {
  require GITHUB_REPOSITORY LOCATION RESOURCE_GROUP PG_SERVER_NAME DOCS_STORAGE_ACCOUNT \
    GHCR_USERNAME GHCR_TOKEN POSTGRES_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD API_JWT_SECRET
  local name
  for name in GHCR_TOKEN POSTGRES_PASSWORD KEYCLOAK_ADMIN_PASSWORD API_JWT_SECRET ADMINER_PASSWORD_HASH SMTP_PASSWORD; do
    [ -z "${!name:-}" ] || printf '%s' "${!name}" | gh secret set "$name" --repo "$GITHUB_REPOSITORY"
  done
  gh variable set AZURE_RESOURCE_GROUP --repo "$GITHUB_REPOSITORY" --body "$RESOURCE_GROUP"
  gh variable set AZURE_LOCATION --repo "$GITHUB_REPOSITORY" --body "$LOCATION"
  gh variable set AZURE_PG_SERVER_NAME --repo "$GITHUB_REPOSITORY" --body "$PG_SERVER_NAME"
  gh variable set AZURE_DOCS_STORAGE_ACCOUNT --repo "$GITHUB_REPOSITORY" --body "$DOCS_STORAGE_ACCOUNT"
  for name in GHCR_USERNAME KEYCLOAK_ADMIN SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_SECURE; do
    [ -z "${!name:-}" ] || gh variable set "$name" --repo "$GITHUB_REPOSITORY" --body "${!name}"
  done
  echo "  GitHub secrets and variables set"
}

# The containerapp CLI has no stop/start, so the request goes straight to the ARM API. It
# returns before the app has changed state, hence the polling.
app_power() {
  local action="$1" app="$2" attempt status
  for attempt in $(seq 1 30); do
    status="$(tsv containerapp show -g "$RESOURCE_GROUP" -n "$app" --query properties.runningStatus)"
    case "$action:$status" in
      stop:Stopped) echo "  $app stopped"; return 0 ;;
      start:Stopped) ;;
      start:*) echo "  $app started"; return 0 ;;
    esac
    [ "$attempt" != 1 ] || az rest --method post -o none --url \
      "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.App/containerApps/$app/$action?api-version=2025-01-01"
    sleep 10
  done
  echo "$app did not $action in time; last status: $status" >&2
  return 1
}

# Adminer is optional, so it only joins stop and start once it exists.
adminer_if_present() { az containerapp show -g "$RESOURCE_GROUP" -n "$ADMINER_APP" -o none 2>/dev/null && echo "$ADMINER_APP"; }

stop_apps() {
  local app
  for app in $(adminer_if_present) "$WEB_APP" "$API_APP" "$AUTH_APP"; do
    app_power stop "$app"
  done
}

# Postgres has to be up first: Keycloak and the API need it to start.
start_apps() {
  local app
  for app in "$AUTH_APP" "$API_APP" "$WEB_APP" $(adminer_if_present); do
    app_power start "$app"
  done
  echo
  echo "Started. Keycloak needs another minute or so before sign-in works."
}

pg_exists() { az postgres flexible-server show -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" -o none 2>/dev/null; }
pg_state() { tsv postgres flexible-server show -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" --query state; }
pg_start() {
  [ "$(pg_state)" = Ready ] || az postgres flexible-server start -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" -o none
  echo "  $PG_SERVER_NAME started"
}

freeze() {
  require PG_SERVER_NAME
  stop_apps
  if ! pg_exists; then
    echo "  $PG_SERVER_NAME does not exist, nothing to stop"
    return 0
  fi
  [ "$(pg_state)" = Stopped ] || az postgres flexible-server stop -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" -o none
  echo "  $PG_SERVER_NAME stopped"
  cat <<EOF

Frozen. Azure restarts a stopped Postgres server after 7 days, so run freeze again before then.
EOF
}

unfreeze() {
  require PG_SERVER_NAME
  pg_exists || { echo "$PG_SERVER_NAME does not exist: run deepunfreeze or initdb." >&2; exit 1; }
  pg_start
  start_apps
}

storage_key() { tsv storage account keys list -g "$RESOURCE_GROUP" -n "$DOCS_STORAGE_ACCOUNT" --query '[0].value'; }

# A URL for one blob that stops working after two hours, so it can sit in the job's secrets.
blob_url() {
  local blob="$1" permissions="$2" key="$3" sas
  sas="$(tsv storage blob generate-sas --account-name "$DOCS_STORAGE_ACCOUNT" --account-key "$key" \
    --container-name "$DUMP_CONTAINER" --name "$blob" --permissions "$permissions" --https-only \
    --expiry "$(date -u -d '+2 hours' +%Y-%m-%dT%H:%MZ)")"
  printf 'https://%s.blob.core.windows.net/%s/%s?%s' "$DOCS_STORAGE_ACCOUNT" "$DUMP_CONTAINER" "$blob" "$sas"
}

# Runs dbtools.sh inside the environment, the only place that can reach the private server.
db_job() {
  local action="$1" url="$2"
  prepare_specs
  { spec_head; cat <<EOF
    triggerType: Manual
    replicaTimeout: 3600
    replicaRetryLimit: 0
    manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
    secrets:
      - name: ghcr-token
        value: "$GHCR_TOKEN"
      - name: pg-password
        value: "$POSTGRES_PASSWORD"
      - name: blob-url
        value: "$url"
  template:
    containers:
      - name: dbtools
        image: $IMAGES/dbtools:$IMAGE_TAG
        args: ["$action"]
        resources: { cpu: 0.5, memory: 1Gi }
        env:
          - { name: PGHOST, value: $PG_HOST }
          - { name: PGSSLMODE, value: require }
          - { name: PGPORT, value: "5432" }
          - { name: PGDATABASE, value: worktime }
          - { name: PGUSER, value: worktime }
          - { name: PGPASSWORD, secretRef: pg-password }
          - { name: BLOB_URL, secretRef: blob-url }
EOF
  } > "$RENDER/dbtools.yaml"
  upsert job "$DB_JOB" "$RENDER/dbtools.yaml"
  run_job "$DB_JOB"
}

deepfreeze() {
  require PG_SERVER_NAME DOCS_STORAGE_ACCOUNT
  stop_apps
  if ! pg_exists; then
    echo "  $PG_SERVER_NAME does not exist, nothing to dump"
    return 0
  fi
  pg_start

  local key blob size
  key="$(storage_key)"
  blob="worktime-$(date -u +%Y%m%dT%H%M%SZ).dump"
  az storage container create --account-name "$DOCS_STORAGE_ACCOUNT" --account-key "$key" \
    --name "$DUMP_CONTAINER" -o none
  db_job dump "$(blob_url "$blob" cw "$key")"

  # Past this point the dump is the only copy, so check it arrived.
  size="$(tsv storage blob show --account-name "$DOCS_STORAGE_ACCOUNT" --account-key "$key" \
    --container-name "$DUMP_CONTAINER" --name "$blob" --query properties.contentLength)"
  [ "${size:-0}" -gt 0 ] || { echo "Dump $blob is missing or empty, keeping $PG_SERVER_NAME." >&2; exit 1; }
  echo "  $blob uploaded ($size bytes)"

  delete_postgres
  cat <<EOF

Deep frozen. Dumps stay in storage account $DOCS_STORAGE_ACCOUNT, container $DUMP_CONTAINER.
Bring it back with deepunfreeze.
EOF
}

deepunfreeze() {
  require LOCATION PG_SERVER_NAME POSTGRES_PASSWORD DOCS_STORAGE_ACCOUNT
  if pg_exists; then
    echo "$PG_SERVER_NAME already exists, so restoring could clash with its data. Use unfreeze, or dropdb first." >&2
    exit 1
  fi
  local key blob
  key="$(storage_key)"
  # The timestamp in the name makes the last one in name order the newest.
  blob="$(tsv storage blob list --account-name "$DOCS_STORAGE_ACCOUNT" --account-key "$key" \
    --container-name "$DUMP_CONTAINER" --query 'sort_by(@, &name)[-1].name' 2>/dev/null || true)"
  if [ -z "$blob" ] || [ "$blob" = None ]; then
    echo "No dump in container $DUMP_CONTAINER: run initdb for an empty database." >&2
    exit 1
  fi
  echo "  restoring $blob"

  ensure_postgres
  db_job restore "$(blob_url "$blob" r "$key")" || {
    echo "Restore failed; $blob is untouched. Fix the cause, then run dropdb and deepunfreeze." >&2
    exit 1
  }
  start_apps
}

dropdb() {
  require PG_SERVER_NAME
  local answer="${CONFIRM:-}"
  if [ "$answer" != "$PG_SERVER_NAME" ]; then
    read -r -p "This deletes $PG_SERVER_NAME and all its data, without a dump. Type its name to continue: " answer || true
  fi
  [ "$answer" = "$PG_SERVER_NAME" ] || { echo "Not confirmed, nothing deleted." >&2; exit 1; }
  stop_apps
  delete_postgres
}

initdb() {
  require LOCATION PG_SERVER_NAME POSTGRES_PASSWORD
  if pg_exists; then
    echo "$PG_SERVER_NAME already exists: run dropdb first." >&2
    exit 1
  fi
  ensure_postgres
  run_job "$MIGRATE_JOB"
  start_apps
  echo "Demo data: infra/azure/provision.sh seed"
}

case "${1:-}" in
  base|apps|seed|github|secrets|freeze|unfreeze|deepfreeze|deepunfreeze|dropdb|initdb|adminer) login_check; "$1" ;;
  *) echo "Usage: $0 base|apps|seed|github|secrets|freeze|unfreeze|deepfreeze|deepunfreeze|dropdb|initdb|adminer" >&2; exit 1 ;;
esac
