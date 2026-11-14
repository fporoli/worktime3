#!/usr/bin/env node
// Resets a local database: drops and recreates the `public` schema, applies the Liquibase
// changelogs (db:migrate) and loads the demo seed (db:seed). Keycloak's `auth` schema is left alone.
//
//   npm run dev:resetdb      (= node scripts/with-env.mjs dev node scripts/reset-db.mjs)
//   npm run local:resetdb
//
// Local development only: it refuses to run outside scripts/with-env.mjs or against a database
// that isn't on this machine. The VPS has its own `reset-seed` workflow action.

import { execFileSync, spawnSync } from 'node:child_process';

const env = process.env.WORKTIME_ENV;
const databaseUrl = process.env.DATABASE_URL;

if (env !== 'dev' && env !== 'local') {
  console.error('Run this through npm run dev:resetdb or npm run local:resetdb.');
  process.exit(1);
}
if (!databaseUrl) {
  console.error(`DATABASE_URL is not set in .env.${env}.`);
  process.exit(1);
}

let url;
try {
  url = new URL(databaseUrl);
} catch {
  console.error(`DATABASE_URL in .env.${env} is not a valid URL.`);
  process.exit(1);
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  console.error(`Refusing to reset ${url.hostname}: only databases on localhost can be reset this way.`);
  process.exit(1);
}

const owner = decodeURIComponent(url.username) || 'worktime';
const target = `${url.hostname}:${url.port || 5432}${url.pathname}`;
const shell = process.platform === 'win32';
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', shell });
let schemaInSync = true;

try {
  console.log(`\n== Resetting ${env} database ${target}: dropping schema public`);
  run('psql', [
    '--no-psqlrc',
    '--quiet',
    '--set=ON_ERROR_STOP=1',
    databaseUrl,
    '-c',
    `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION "${owner.replace(/"/g, '""')}";`,
  ]);

  console.log('\n== Migrating (Liquibase)');
  run('npm', ['run', 'db:migrate']);

  // The database now is exactly what the changelogs make; the generated Drizzle schema must
  // describe it. A mismatch doesn't stop the reset, but is reported at the end.
  console.log('\n== Checking src/db/schema.ts against the migrated database');
  schemaInSync = spawnSync('npm', ['run', '--silent', 'db:checkschema'], { stdio: 'inherit', shell }).status === 0;

  console.log('\n== Seeding');
  run('npm', ['run', 'db:seed']);
} catch {
  console.error(`\nReset of the ${env} database failed (see above). Is its Postgres running (npm run ${env}:up)?`);
  process.exit(1);
}

console.log(`\n== Done: the ${env} database is migrated and seeded.`);
if (!schemaInSync) {
  console.warn(`\nWARNING: apps/api/src/db/schema.ts does not match the migrated database (see above).`);
  console.warn(`Run npm run ${env}:introspect and commit the result.`);
}
