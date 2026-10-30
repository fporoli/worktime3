# Liquibase's official image ships without a JDBC driver (licensing/size) —
# this adds the Postgres one so `docker compose` can run migrations with no
# extra host setup. Pin both versions explicitly; bump deliberately.
FROM liquibase/liquibase:5.0.4

RUN curl -sL -o /liquibase/lib/postgresql.jar \
    https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar

# Bake the changelogs in so the image also works where nothing can be mounted from the repo
# (Azure Container Apps job). Compose and migrate.mjs still mount ./changelog over this copy.
COPY changelog /liquibase/changelog
