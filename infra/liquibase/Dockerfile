# Liquibase's official image ships without a JDBC driver (licensing/size) —
# this adds the Postgres one so `docker compose` can run migrations with no
# extra host setup. Pin both versions explicitly; bump deliberately.
FROM liquibase/liquibase:5.0.4

RUN curl -sL -o /liquibase/lib/postgresql.jar \
    https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar
