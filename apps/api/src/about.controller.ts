import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { hostname } from 'node:os';
import { DbService } from './db.service';
import type { Executor } from './access';

const STARTED_AT = new Date().toISOString();

/** Baked into the image by build-push (see apps/api/Dockerfile) — unset on a host build. */
export function buildInfo(env: Record<string, string | undefined> = process.env) {
  return { release: env.BUILD_RELEASE || null, commit: env.BUILD_COMMIT || null, date: env.BUILD_DATE || null };
}

/** Whether the database answers, and the last changeset Liquibase applied to it. */
export async function databaseInfo(db: Executor | null) {
  if (!db) return { status: 'offline', lastChangeset: null };
  try {
    const rows = await db.execute(sql`SELECT filename FROM databasechangelog ORDER BY orderexecuted DESC LIMIT 1`);
    return { status: 'ok', lastChangeset: (rows.rows[0]?.filename as string) ?? null };
  } catch {
    return { status: 'unavailable', lastChangeset: null };
  }
}

@Controller('about')
export class AboutController {
  constructor(private readonly db: DbService) {}

  /** Behind the global JWT guard, unlike `health`: registration is open, so keep this free of anything sensitive. */
  @Get()
  async about() {
    return {
      ok: true,
      build: buildInfo(),
      server: {
        hostname: hostname(),
        environment: process.env.NODE_ENV || null,
        nodeVersion: process.version,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        startedAt: STARTED_AT,
        time: new Date().toISOString(),
      },
      database: await databaseInfo(this.db.getDb()),
    };
  }
}
