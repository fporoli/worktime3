#!/usr/bin/env node
// Runs a seed .sql file against $DATABASE_URL via psql.
// A plain `psql $DATABASE_URL -f ...` npm script only works on shells that
// expand $VARS (bash); on Windows, npm runs scripts through cmd.exe, which
// passes "$DATABASE_URL" through literally and psql silently falls back to
// its defaults (localhost:5432). Reading the env var in Node sidesteps that.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  try {
    const envFile = readFileSync(resolve(repoRoot, '.env'), 'utf8');
    const match = envFile.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/m);
    databaseUrl = match?.[1] ?? '';
    if (
      (databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) ||
      (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))
    ) {
      databaseUrl = databaseUrl.slice(1, -1);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (!databaseUrl) {
  console.error('Set DATABASE_URL, e.g. postgresql://worktime:pw@localhost:5431/worktime');
  process.exit(1);
}

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node infra/postgres/run-seed.mjs <path-to-seed.sql>');
  process.exit(1);
}

execFileSync(
  'psql',
  ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--single-transaction', databaseUrl, '-f', sqlFile],
  { stdio: 'inherit' },
);
