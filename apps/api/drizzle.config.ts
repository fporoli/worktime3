import { defineConfig } from 'drizzle-kit';

// Drizzle never owns migrations here — Liquibase does (see infra/liquibase).
// This config exists only for `drizzle-kit introspect`: after applying a
// Liquibase changelog, regenerate src/db/schema.ts from the live database so
// the app's types stay in sync with it. Never hand-edit schema.ts.
export default defineConfig({
  dialect: 'postgresql',
  // Scratch dir: drizzle-kit also writes its own migration-snapshot
  // bookkeeping here (meta/, a numbered .sql file) which we don't want —
  // Liquibase owns migrations. `npm run db:introspect` copies out only
  // schema.ts/relations.ts and discards the rest.
  out: './.drizzle-introspect',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://worktime:worktime_dev_only@localhost:5431/worktime',
  },
  introspect: {
    casing: 'preserve',
  },
});
