# One-shot dump and restore for the Azure Container Apps job (see infra/azure/provision.sh):
# the private Postgres server is only reachable from inside the VNet.
FROM postgres:16-alpine
RUN apk add --no-cache curl
COPY dbtools.sh /usr/local/bin/dbtools.sh
ENTRYPOINT ["sh", "/usr/local/bin/dbtools.sh"]
