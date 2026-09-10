#!/usr/bin/env node
// Applies infra/liquibase/changelog to $DATABASE_URL via the dockerized
// Liquibase image (built from ./Dockerfile). Used by `npm run db:migrate`
// and CI; docker-compose environments run the `migrate` service directly
// instead (see any compose/docker-compose.*.yml).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL, e.g. postgresql://worktime:pw@localhost:5431/worktime');
  process.exit(1);
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

execFileSync(
  'docker',
  [
    'run', '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '-v', `${here}/changelog:/liquibase/changelog:ro`,
    image,
    '--changelog-file=db.changelog-master.xml',
    `--url=jdbc:postgresql://${host}:${port}/${dbName}`,
    `--username=${user}`,
    `--password=${pass}`,
    'update',
  ],
  { stdio: 'inherit' },
);
