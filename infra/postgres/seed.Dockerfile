# One-shot demo-data seeder for environments that can't mount the repo (Azure Container Apps
# job). Connection comes from the standard PG* env vars; same psql flags as run-seed.mjs.
FROM postgres:16-alpine
COPY seeds/seed.sql /seed/seed.sql
ENTRYPOINT ["psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--single-transaction", "-f", "/seed/seed.sql"]
