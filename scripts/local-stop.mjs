#!/usr/bin/env node
// Stops the API and web processes started by `npm run dev:local`, by pid
// file. Leaves the docker infra (pg/keycloak/mailpit) running — stop that
// separately with `docker compose -f compose/docker-compose.local.yml down`.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pidsDir = join(root, 'pids');

for (const name of ['api', 'web']) {
  const pidFile = join(pidsDir, `local-${name}.pid`);
  if (!existsSync(pidFile)) {
    console.log(`${name}: not running (no ${pidFile})`);
    continue;
  }
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  try {
    process.kill(pid);
    console.log(`${name}: stopped (pid ${pid})`);
  } catch (err) {
    console.log(`${name}: pid ${pid} not running (${err.code}) — clearing stale pidfile`);
  }
  unlinkSync(pidFile);
}
