#!/usr/bin/env node
// Starts the local setup end to end: the dockerized infra (pg + keycloak
// + mailpit, idempotent — left alone if already up) plus the API and web app
// on the host, both in the background. `npm run dev:local:stop` stops the
// latter two again; it never touches the docker infra.
//
// api runs against its last build (see the root "predev:local" hook, which
// rebuilds it first) — not a watcher, so a src change needs `npm run
// dev:local` again to take effect. web (vite) hot-reloads on its own.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logsDir = join(root, 'logs');
const pidsDir = join(root, 'pids');
mkdirSync(logsDir, { recursive: true });
mkdirSync(pidsDir, { recursive: true });

console.log('Starting local infra (pg + keycloak + mailpit)...');
execFileSync('docker', ['compose', '-f', 'compose/docker-compose.local.yml', 'up', '-d'], { cwd: root, stdio: 'inherit' });

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startBackground(name, command, args, cwd) {
  const pidFile = join(pidsDir, `local-${name}.pid`);
  if (existsSync(pidFile)) {
    console.error(`${name}: already running (${pidFile} exists) — run "npm run dev:local:stop" first.`);
    process.exit(1);
  }
  const logFile = join(logsDir, `local-${name}.log`);
  const fd = openSync(logFile, 'a');
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  return { name, pid: child.pid, pidFile, logFile };
}

const started = [
  startBackground('api', 'node', ['--env-file=../../.env', 'dist/main.js'], join(root, 'apps/api')),
  startBackground('web', join(root, 'apps/web/node_modules/.bin/vite'), ['--port', '3001'], join(root, 'apps/web')),
];

// A crash-on-boot (e.g. the port already being held by something else) exits well within
// this window — long enough to catch that without slowing down the common case.
await delay(1500);

let allOk = true;
for (const { name, pid, pidFile, logFile } of started) {
  if (isAlive(pid)) {
    console.log(`${name}: started (pid ${pid}, logs at ${logFile})`);
  } else {
    allOk = false;
    unlinkSync(pidFile);
    console.error(`${name}: exited right after starting — see ${logFile}:`);
    console.error(readFileSync(logFile, 'utf8').trim().split('\n').slice(-15).map((l) => `  ${l}`).join('\n'));
  }
}

if (allOk) console.log('\nweb: http://localhost:3001  api: http://localhost:8001/api/v1/health');
else process.exit(1);
