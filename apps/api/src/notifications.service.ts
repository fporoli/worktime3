import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { notifications } from './db/schema';
import { NotificationsGateway } from './notifications.gateway';

/**
 * Persisted, per-recipient notification feed — source of truth for the bell icon.
 * `notifyMany` inserts one row per recipient (so a team-assigned workflow gives every
 * member their own independent read state), then pushes a live copy to whichever of
 * them are currently connected via NotificationsGateway. A missed push is never a lost
 * notification, only a delayed one — the row already exists here.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DbService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async notifyMany(params: {
    organizationId: string;
    recipientUserIds: string[];
    type: string;
    title: string;
    body?: string;
    sourceTable: string;
    sourceTableUuid: string;
    workflowId?: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const db = this.db.getDb();
    if (!db || params.recipientUserIds.length === 0) return;
    const rows = await db
      .insert(notifications)
      .values(
        params.recipientUserIds.map((recipientUserId) => ({
          organization_id: params.organizationId,
          recipient_user_id: recipientUserId,
          type: params.type,
          title: params.title,
          body: params.body ?? null,
          source_table: params.sourceTable,
          source_table_uuid: params.sourceTableUuid,
          workflow_id: params.workflowId ?? null,
          data: params.data ?? {},
        })),
      )
      .returning();
    for (const row of rows) this.gateway.pushToUser(row.recipient_user_id, row);
  }

  async list(recipientUserId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    const db = this.db.getDb();
    if (!db) return [];
    const conditions = [eq(notifications.recipient_user_id, recipientUserId)];
    if (opts.unreadOnly) conditions.push(isNull(notifications.read_at));
    return db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.created_at))
      .limit(opts.limit ?? 50);
  }

  async unreadCount(recipientUserId: string): Promise<number> {
    const db = this.db.getDb();
    if (!db) return 0;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.recipient_user_id, recipientUserId), isNull(notifications.read_at)));
    return row?.count ?? 0;
  }

  async markRead(recipientUserId: string, id: string): Promise<boolean> {
    const db = this.db.getDb();
    if (!db) return false;
    const rows = await db
      .update(notifications)
      .set({ read_at: new Date().toISOString() })
      .where(and(eq(notifications.id, id), eq(notifications.recipient_user_id, recipientUserId), isNull(notifications.read_at)))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  async markAllRead(recipientUserId: string): Promise<number> {
    const db = this.db.getDb();
    if (!db) return 0;
    const rows = await db
      .update(notifications)
      .set({ read_at: new Date().toISOString() })
      .where(and(eq(notifications.recipient_user_id, recipientUserId), isNull(notifications.read_at)))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
