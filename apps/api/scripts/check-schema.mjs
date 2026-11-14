#!/usr/bin/env node
// Checks that the committed src/db/schema.ts and relations.ts describe the database at
// $DATABASE_URL: introspects it into a scratch folder (drizzle-kit, then the same fixes as
// `npm run db:introspect`) and compares the result with the committed files.
//
// Table order is ignored: drizzle-kit writes tables in the order the database created them,
// which differs between a database reset from scratch and one migrated step by step. Each
// exported block (table, enum, view, relations) is compared on its own.
//
// Exit 0 when they match, 1 when they don't (naming the blocks that differ), 2 on errors.
// Run after migrating: on a freshly migrated database a difference means a changelog was added
// without `npm run dev:introspect` (or schema.ts was edited by hand).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(apiDir, '.drizzle-introspect'); // drizzle.config.ts `out`
const shell = process.platform === 'win32';

if (!process.env.DATABASE_URL) {
  console.error('check-schema: DATABASE_URL is not set. Use npm run dev:checkschema / local:checkschema, or set DATABASE_URL.');
  process.exit(2);
}

/** Exported blocks by name, each normalized (whitespace, trailing commas, line order). */
function blocks(source) {
  const map = new Map();
  let name = null;
  let lines = [];
  // Lines are compared as a sorted set: the order of relations and constraints inside a block
  // follows the database's history too.
  const flush = () => {
    if (name) map.set(name, lines.map((l) => l.replace(/,$/, '')).filter(Boolean).sort().join('\n'));
  };
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^export const (\w+)\b/.exec(line);
    if (m) {
      flush();
      name = m[1];
      lines = [];
    }
    if (name) lines.push(line.trimEnd());
  }
  flush();
  return map;
}

function compare(label, committedPath, freshPath) {
  const committed = blocks(readFileSync(committedPath, 'utf8'));
  const fresh = blocks(readFileSync(freshPath, 'utf8'));
  const problems = [];
  for (const [name, text] of fresh) {
    if (!committed.has(name)) problems.push(`  + ${name}   (in the database, missing from ${label})`);
    else if (committed.get(name) !== text) problems.push(`  ~ ${name}   (differs)`);
  }
  for (const name of committed.keys()) if (!fresh.has(name)) problems.push(`  - ${name}   (in ${label}, not in the database)`);
  return problems;
}

let problems;
try {
  rmSync(scratch, { recursive: true, force: true });
  execFileSync('npx', ['drizzle-kit', 'introspect'], { cwd: apiDir, stdio: ['ignore', 'ignore', 'inherit'], shell });
  execFileSync('node', [join(apiDir, 'scripts', 'fix-introspected-schema.mjs'), join(scratch, 'schema.ts')], { stdio: 'ignore' });
  if (!existsSync(join(scratch, 'schema.ts'))) throw new Error('drizzle-kit wrote no schema.ts');
  problems = [
    ...compare('schema.ts', join(apiDir, 'src', 'db', 'schema.ts'), join(scratch, 'schema.ts')),
    ...compare('relations.ts', join(apiDir, 'src', 'db', 'relations.ts'), join(scratch, 'relations.ts')),
  ];
} catch (err) {
  console.error(`check-schema: could not introspect the database (${err.message}).`);
  process.exit(2);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (problems.length === 0) {
  console.log('check-schema: schema.ts and relations.ts match the database.');
  process.exit(0);
}
console.error(`check-schema: schema.ts / relations.ts do not match the database:\n${problems.join('\n')}`);
console.error('On a freshly migrated database this means a changelog was added without regenerating them:');
console.error('run npm run dev:introspect and commit the result (never edit schema.ts by hand).');
process.exit(1);
