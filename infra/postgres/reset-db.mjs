#!/usr/bin/env node
// Drops and recreates the `public` schema on $DATABASE_URL, leaving the auth
// schema (Keycloak) untouched and the database empty for `db:migrate` +
// `db:seed` to rebuild. Used by `npm run db:clean` / `db:reset`.
//
// Refuses a non-local target unless --force is passed, so a DATABASE_URL that
// happens to point at a shared or remote database can't be wiped by a stray
// `npm run db:clean`.
import { execFileSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL, e.g. postgresql://worktime:pw@localhost:5431/worktime');
  process.exit(1);
}

const force = process.argv.includes('--force');
const host = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:')).hostname;
if (!force && host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`DATABASE_URL points at "${host}", not localhost. Re-run with --force if that's really what you want.`);
  process.exit(1);
}

console.log(`Dropping and recreating the public schema on ${host}...`);
execFileSync(
  'psql',
  [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'DROP SCHEMA public CASCADE', '-c', 'CREATE SCHEMA public'],
  { stdio: 'inherit' },
);
