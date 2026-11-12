#!/usr/bin/env node
// Runs a command with one local environment's settings: `.env.dev` or `.env.local`.
//
//   node scripts/with-env.mjs <dev|local> <command> [args...]
//
// Backs the `dev:*` and `local:*` npm scripts (package.json), so nobody has to source an env
// file into their shell. The file's values win over the shell's, so `npm run dev:seed` always
// means dev, even in a shell that still holds another environment's DATABASE_URL. psql's
// PG* variables are derived from POSTGRES_* when the file doesn't set them.
//
// For local development only. CI and the VPS/Azure deploys never use this: they run the plain
// scripts (db:migrate, db:seed, build, start) with config from GitHub Environments.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ENVIRONMENTS = ['dev', 'local'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [name, command, ...args] = process.argv.slice(2);

if (!ENVIRONMENTS.includes(name) || !command) {
  console.error(`Usage: node scripts/with-env.mjs <${ENVIRONMENTS.join('|')}> <command> [args...]`);
  process.exit(2);
}

const file = join(root, `.env.${name}`);
if (!existsSync(file)) {
  console.error(`Missing .env.${name}. Create it once from the example: cp env.example.${name}.cfg .env.${name}  (Windows: copy)`);
  process.exit(1);
}

const values = parseEnv(readFileSync(file, 'utf8'));
const env = { ...process.env, ...values, WORKTIME_ENV: name };
const derived = { PGHOST: 'POSTGRES_HOST', PGPORT: 'POSTGRES_PORT', PGUSER: 'POSTGRES_USER', PGPASSWORD: 'POSTGRES_PASSWORD', PGDATABASE: 'POSTGRES_DB' };
for (const [pg, source] of Object.entries(derived)) {
  if (values[pg] === undefined && values[source] !== undefined) env[pg] = values[source];
}

// On Windows `npm` and `docker` are resolved through the shell (npm.cmd).
const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
// Ctrl+C reaches the child directly (same terminal); stay alive until it has exited.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {});
child.on('error', (err) => {
  console.error(`Could not start "${command}": ${err.message}`);
  process.exit(127);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
