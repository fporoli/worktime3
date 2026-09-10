#!/usr/bin/env node
// drizzle-kit introspect doesn't know how to map Postgres's `citext` type
// (used by users.email, organizations.slug, organization_domains.domain,
// and organization_invitations.email) and emits an uncompilable
// `unknown("col")` placeholder for each column. This patches schema.ts
// right after introspection so `npm run db:introspect` stays a single,
// rerunnable command instead of a "regenerate, then remember to hand-fix"
// two-step process.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'schema.ts');
const before = readFileSync(schemaPath, 'utf8');
let src = before;

src = src.replace(/\t\/\/ TODO: failed to parse database type 'citext'\n/g, '');
src = src.replace(/\bunknown\((["'])(\w+)\1\)/g, 'citext($1$2$1)');

if (src === before) {
  console.log(
    'fix-introspected-schema: no citext placeholders found — nothing to patch ' +
      '(if drizzle-kit added native citext support, this script can be retired).',
  );
  process.exit(0);
}

// Add `customType` to the existing drizzle-orm/pg-core import instead of a new line.
src = src.replace(/import \{([^}]*)\} from "drizzle-orm\/pg-core"/, (full, names) =>
  names.includes('customType') ? full : `import {${names.trimEnd()}, customType } from "drizzle-orm/pg-core"`,
);

// Define the citext customType once, right after the drizzle-orm imports.
const citextDef =
  "\nconst citext = customType<{ data: string }>({\n  dataType() {\n    return 'citext';\n  },\n});\n";
src = src.replace(/(import \{ sql \} from "drizzle-orm"\n)/, `$1${citextDef}`);

writeFileSync(schemaPath, src);
console.log('fix-introspected-schema: patched citext columns (users.email, organizations.slug, and others).');
