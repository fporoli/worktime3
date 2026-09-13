import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { versions } from './db/schema';

export type VersionAction = 'insert' | 'update' | 'update_delta' | 'delete';

/**
 * Generic per-record history, replacing the created_at/updated_at columns
 * dropped from every regular table. One row per (sourceTable,
 * sourceTableUuid); each write appends one entry to its history[] and bumps
 * version_nr, in a single upsert so concurrent writers can't race each other
 * into overwriting the same version number.
 */
@Injectable()
export class VersionsService {
  constructor(private readonly db: DbService) {}

  async record(
    sourceTable: string,
    sourceTableUuid: string,
    action: VersionAction,
    actorUserId: string | null,
    record: unknown,
  ) {
    const db = this.db.getDb();
    if (!db) return;
    const now = new Date().toISOString();
    const firstEntry = [{ version: 1, action, actioned_by_user_uuid: actorUserId, actioned_date: now, record }];

    await db
      .insert(versions)
      .values({
        source_table: sourceTable,
        source_table_uuid: sourceTableUuid,
        version_nr: 1,
        created_by_user_id: actorUserId,
        lastmodified_by_user_id: actorUserId,
        history: firstEntry,
      })
      .onConflictDoUpdate({
        target: [versions.source_table, versions.source_table_uuid],
        set: {
          version_nr: sql`${versions.version_nr} + 1`,
          lastmodified: sql`now()`,
          lastmodified_by_user_id: actorUserId,
          history: sql`${versions.history} || jsonb_build_array(jsonb_build_object(
            'version', ${versions.version_nr} + 1,
            'action', ${action}::text,
            'actioned_by_user_uuid', ${actorUserId}::uuid,
            'actioned_date', ${now}::timestamptz,
            'record', ${JSON.stringify(record ?? null)}::jsonb
          ))`,
        },
      });
  }
}
