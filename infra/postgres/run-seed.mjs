#!/usr/bin/env node
// Runs a seed .sql file against $DATABASE_URL via psql.
// A plain `psql $DATABASE_URL -f ...` npm script only works on shells that
// expand $VARS (bash); on Windows, npm runs scripts through cmd.exe, which
// passes "$DATABASE_URL" through literally and psql silently falls back to
// its defaults (localhost:5432). Reading the env var in Node sidesteps that.
import { execFileSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL, e.g. postgresql://worktime:pw@localhost:5431/worktime');
  process.exit(1);
}

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node infra/postgres/run-seed.mjs <path-to-seed.sql>');
  process.exit(1);
}

execFileSync('psql', [databaseUrl, '-f', sqlFile], { stdio: 'inherit' });
