#!/usr/bin/env node
// Runs Liquibase against $DATABASE_URL with infra/liquibase/changelog, via the dockerized
// Liquibase image (built from ./Dockerfile). docker-compose environments run the `migrate`
// service directly instead (see any compose/docker-compose.*.yml).
//
//   node migrate.mjs          `update`: apply the pending changesets (npm run db:migrate, CI)
//   node migrate.mjs status   read-only (npm run db:status): compares the database's
//                             DATABASECHANGELOG with the changelogs in this checkout and exits 1
//                             when changesets are pending, the database ran changesets this
//                             checkout doesn't have (it is ahead, or on another branch), or an
//                             applied changeset was edited afterwards (checksum mismatch).
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2] ?? 'update';
if (!['update', 'status'].includes(command)) {
  console.error(`Unknown command "${command}" (update or status).`);
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL, e.g. postgresql://worktime:pw@localhost:5431/worktime');
  process.exit(2);
}

const u = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:'));
// The migration runs inside a container; "localhost" there is the container
// itself, not the host running docker. host-gateway (below) resolves this.
const host = u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? 'host.docker.internal' : u.hostname;
const port = u.port || '5432';
const dbName = u.pathname.replace(/^\//, '');
const user = decodeURIComponent(u.username);
const pass = decodeURIComponent(u.password);

const image = execFileSync('docker', ['build', '-q', '-f', 'Dockerfile', '.'], { cwd: here }).toString().trim();

const liquibaseArgs = (...cmd) => [
  'run', '--rm',
  '--add-host=host.docker.internal:host-gateway',
  '-v', `${here}/changelog:/liquibase/changelog:ro`,
  image,
  '--changelog-file=db.changelog-master.xml',
  `--url=jdbc:postgresql://${host}:${port}/${dbName}`,
  `--username=${user}`,
  `--password=${pass}`,
  ...cmd,
];

if (command === 'update') {
  execFileSync('docker', liquibaseArgs('update'), { stdio: 'inherit' });
  process.exit(0);
}

/** Runs one read-only Liquibase command; returns its output without the banner. */
function liquibase(...cmd) {
  const r = spawnSync('docker', liquibaseArgs(...cmd), { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => l.trim() && !/^(#|Starting Liquibase|Liquibase Version|Liquibase command .* was executed successfully)/.test(l))
    .join('\n');
  return { ok: r.status === 0, out };
}

const target = `${dbName} on ${u.hostname}:${port}`;
const problems = [];

// status and unexpected-changesets validate checksums first and fail the same way, so a
// checksum problem is reported once, from validate.
const checksums = liquibase('validate');
if (!checksums.ok) {
  const detail = checksums.out.split('\n').filter((l) => !/^(ERROR: Exception|Unexpected error|For more information)/.test(l));
  // Liquibase prints the failure twice (exception reason and error message).
  const detailText = [...new Set(detail)].join('\n');
  console.error(`db:status: ${target} does not match this checkout.\n\nValidation failed (an applied changeset was edited afterwards, or the database is broken):\n${detailText}`);
  process.exit(1);
}

const pending = liquibase('status', '--verbose');
if (!pending.ok) problems.push(`status failed:\n${pending.out}`);
else if (!/is up to date/.test(pending.out)) problems.push(`Pending (in this checkout, not yet applied; npm run db:migrate applies them):\n${pending.out}`);

const unexpected = liquibase('unexpected-changesets', '--verbose');
if (!unexpected.ok) problems.push(`unexpected-changesets failed:\n${unexpected.out}`);
else if (!/contains no unexpected changes/.test(unexpected.out)) {
  problems.push(`Applied to the database but not in this checkout (the database is ahead, or migrated from another branch):\n${unexpected.out}`);
}

if (problems.length === 0) {
  console.log(`db:status: ${target} has exactly the changesets of this checkout, with matching checksums.`);
  process.exit(0);
}
console.error(`db:status: ${target} does not match this checkout.\n\n${problems.join('\n\n')}`);
process.exit(1);
