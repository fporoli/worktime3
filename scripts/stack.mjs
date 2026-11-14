#!/usr/bin/env node
// One command line for every environment:
//
//   npm run stack -- <env> <steps...> [--yes]
//
//   env    dev | local            this machine (.env.dev / .env.local, scripts/with-env.mjs)
//          prod | preprod | test  a VPS instance (any GitHub Environment except azure)
//          azure                  Azure Container Apps
//   steps  push   git push the current branch (commit first; uncommitted changes are not pushed)
//          build  dev: npm run build. local: build the Docker images.
//                 remote: wait for the GHCR images of HEAD (build-push), dispatching it off main
//          reset  DESTRUCTIVE: drop the public schema, migrate, load the demo seed
//                 (VPS: `reset-seed`, backed up first; Azure: drop and re-create the Postgres
//                 server, which also resets Keycloak)
//          start  dev: services in Docker + API and web on the host (Ctrl-C stops them).
//                 local: the whole Docker stack. remote: deploy HEAD's images (migrations run first).
//          stop   dev / local only: docker compose down
//          all    push build reset start
//   --yes  skip the typed confirmation of a remote reset (for scripts; dev/local never ask)
//
// Steps always run in the order push, build, reset, start (stop alone), whatever order they are
// given in. On remote environments start comes before reset, so the reset runs the new
// migrations and seed. Examples:
//
//   npm run stack -- dev reset start       fresh demo database, then API + web
//   npm run stack -- local all             push, rebuild images, reset, bring the stack up
//   npm run stack -- test push build start deploy HEAD to the `test` VPS instance
//   npm run stack -- prod start            deploy HEAD's images (already built) to prod
//
// Remote steps only trigger the GitHub workflows (vps.yml, azure.yml, azure-deploy.yml,
// build-push.yml) with the gh CLI and wait for them; config stays in GitHub Environments.

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const shell = process.platform === 'win32';
const ORDER = ['push', 'build', 'reset', 'start', 'stop'];
const LOCAL = new Set(['dev', 'local']);

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error('Usage: npm run stack -- <dev|local|prod|preprod|test|azure|...> <push|build|reset|start|stop|all>... [--yes]');
  process.exit(1);
}

function run(command, args, { capture = false, allowFail = false } = {}) {
  if (!capture) console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', shell, encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) {
    console.error(`\n${command} ${args[0] ?? ''} failed (exit ${result.status}).`);
    process.exit(result.status || 1);
  }
  return capture ? (result.stdout ?? '').trim() : result.status;
}

const git = (...args) => run('git', args, { capture: true });
const gh = (...args) => run('gh', args, { capture: true });
const npm = (...args) => run('npm', args);
const withEnv = (env, ...args) => run('node', ['scripts/with-env.mjs', env, ...args]);
const compose = (env, ...args) => withEnv(env, 'docker', 'compose', '-f', `compose/docker-compose.${env}.yml`, ...args);

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Arguments

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const [env, ...rest] = args.filter((a) => a !== '--yes');
if (!env) usage();
const requested = new Set(rest.flatMap((s) => (s === 'all' ? ['push', 'build', 'reset', 'start'] : [s])));
if (requested.size === 0) usage('Name at least one step.');
for (const s of requested) if (!ORDER.includes(s)) usage(`Unknown step "${s}".`);
if (requested.has('stop') && requested.size > 1) usage('"stop" runs on its own.');

const remote = !LOCAL.has(env);
if (remote) {
  if (requested.has('stop')) usage('"stop" is for dev and local only (to pause Azure, run the azure workflow\'s freeze).');
  const environments = gh('api', 'repos/{owner}/{repo}/environments', '--jq', '.environments[].name').split('\n').filter(Boolean);
  if (!environments.includes(env)) usage(`"${env}" is neither dev/local nor a GitHub Environment (${environments.join(', ')}).`);
}

// ---------------------------------------------------------------------------------------------
// Steps shared by every environment

function push() {
  if (git('status', '--porcelain')) console.warn('\nNote: there are uncommitted changes; they are not pushed (or deployed).');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  run('git', ['push', 'origin', branch]);
}

function headInfo() {
  const sha = git('rev-parse', 'HEAD');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('fetch', '--quiet', 'origin');
  const onRemote = run('git', ['branch', '-r', '--contains', sha], { capture: true, allowFail: true });
  if (!onRemote) {
    console.error(`\nHEAD ${sha.slice(0, 7)} is not on GitHub yet: add the "push" step (or git push first).`);
    process.exit(1);
  }
  return { sha, branch, tag: `sha-${sha.slice(0, 7)}` };
}

// ---------------------------------------------------------------------------------------------
// GitHub Actions helpers

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Waits for a run to appear (newest first), then follows it until it ends; fails the script if it fails. */
async function watch(listArgs, label) {
  let id = '';
  for (let i = 0; i < 60 && !id; i++) {
    id = gh('run', 'list', ...listArgs, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // empty');
    if (!id) await sleep(5000);
  }
  if (!id) {
    console.error(`\nNo ${label} run showed up on GitHub.`);
    process.exit(1);
  }
  console.log(`\n${label}: following run ${id}`);
  run('gh', ['run', 'watch', id, '--exit-status', '--interval', '15']);
}

/** Dispatches a workflow and follows the run it created. */
async function dispatch(workflow, fields, label, ref) {
  const since = new Date(Date.now() - 5000).toISOString();
  const flags = Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`]);
  run('gh', ['workflow', 'run', workflow, ...(ref ? ['--ref', ref] : []), ...flags]);
  await watch(['--workflow', workflow, '--event', 'workflow_dispatch', '--created', `>=${since}`], label);
}

async function confirmReset(what) {
  if (yes) return;
  console.log(`\n${what}`);
  const answer = await ask(`Type the environment name (${env}) to continue: `);
  if (answer !== env) {
    console.error('Not confirmed; nothing was reset.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------
// dev / local

function localBuild() {
  if (env === 'dev') npm('run', 'build');
  else compose('local', 'build');
}

function localReset() {
  // The database container must run (and, for local, Keycloak shares it; it is left alone).
  if (env === 'dev') npm('run', 'dev:up');
  else compose('local', 'up', '-d', 'pg');
  npm('run', `${env}:resetdb`);
}

async function localStart() {
  if (env === 'local') {
    npm('run', 'local:up');
    console.log('\nLocal stack: web http://localhost:3002, API http://localhost:8002, Keycloak http://localhost:8092');
    return;
  }
  npm('run', 'dev:up');
  console.log('\nStarting API (:8001) and web (:3001); Ctrl-C stops both.');
  const children = ['dev:api', 'dev:web'].map((script) => spawn('npm', ['run', script], { stdio: 'inherit', shell }));
  const stopAll = () => children.forEach((c) => c.exitCode === null && c.kill('SIGINT'));
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  const codes = await Promise.all(
    children.map((c) => new Promise((resolve) => c.on('exit', (code) => { stopAll(); resolve(code ?? 0); }))),
  );
  process.exit(Math.max(...codes));
}

// ---------------------------------------------------------------------------------------------
// VPS instances and Azure

async function remoteBuild() {
  const { sha, branch } = headInfo();
  const existing = gh('run', 'list', '--workflow', 'build-push.yml', '--commit', sha, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // empty');
  if (existing || branch === 'main') {
    // A push to main builds by itself (sha-<commit> and latest).
    await watch(['--workflow', 'build-push.yml', '--commit', sha], 'build-push');
  } else {
    // Off main: build this branch, tagged by branch name (and sha-<commit>), leaving latest alone.
    await dispatch('build-push.yml', { image_tag: branch.replace(/[^A-Za-z0-9_.-]/g, '-') }, 'build-push', branch);
  }
}

async function remoteStart() {
  // Dispatched on the current branch, so the migrations and seed shipped match the images.
  const { tag, branch } = headInfo();
  if (env === 'azure') await dispatch('azure-deploy.yml', { image_tag: tag }, 'azure-deploy', branch);
  else await dispatch('vps.yml', { action: 'deploy', environment: env, image_tag: tag }, `vps deploy ${env}`, branch);
}

async function remoteReset() {
  const { tag, branch } = headInfo();
  if (env === 'azure') {
    const server = gh('variable', 'get', 'AZURE_PG_SERVER_NAME', '--env', 'azure');
    await confirmReset(`This DELETES the Azure Postgres server ${server} (all data, Keycloak's too) and creates a new one with the demo seed and image ${tag}. It takes a while.`);
    await dispatch('azure.yml', { action: 'dropdb', confirm: server }, 'azure dropdb', branch);
    await dispatch('azure.yml', { action: 'initdb', seed: 'true', image_tag: tag }, 'azure initdb', branch);
    return;
  }
  await confirmReset(`This drops the public schema of ${env} (backed up on the server first), migrates and loads the demo seed.`);
  await dispatch('vps.yml', { action: 'reset-seed', environment: env, image_tag: tag, confirmation: 'RESET worktime3 public schema' }, `vps reset-seed ${env}`, branch);
}

// ---------------------------------------------------------------------------------------------

const has = (s) => requested.has(s);

if (has('stop')) {
  npm('run', `${env}:down`);
  process.exit(0);
}
if (has('push')) push();
if (!remote) {
  if (has('build')) localBuild();
  if (has('reset')) localReset();
  if (has('start')) await localStart();
} else {
  if (has('build')) await remoteBuild();
  // Azure's reset creates the apps with the new images itself, so it replaces the deploy.
  if (has('start') && !(env === 'azure' && has('reset'))) await remoteStart();
  if (has('reset')) await remoteReset();
}
console.log(`\nDone: ${env} ${ORDER.filter(has).join(' ')}.`);
