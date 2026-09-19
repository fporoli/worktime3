import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { basicdata_versions, users } from './db/schema';

export type BasicDataStatus = 'approved' | 'changerequested' | 'rejected';

export interface BasicDataHistoryEntry {
  version: number;
  status: BasicDataStatus;
  data: Record<string, unknown>;
  requested_by_user_id: string;
  requested_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  note: string | null;
}

/**
 * "Meine Daten" personal/family data: the current value lives as a JSON blob on users.basicdata,
 * while every edit — applied or merely requested — is appended to a per-user basicdata_versions
 * history[]. An admin/HR edit (applyDirectEdit) merges into users.basicdata immediately and is
 * recorded already 'approved'; anyone else's edit (requestChange) only ever appends a
 * 'changerequested' entry, which sits there until an admin/HR calls resolveRequest.
 */
@Injectable()
export class BasicDataService {
  constructor(private readonly db: DbService) {}

  /** The user's basicdata_versions row, creating an empty one on first touch. */
  private async row(db: Db, userId: string) {
    const [existing] = await db.select().from(basicdata_versions).where(eq(basicdata_versions.user_id, userId));
    if (existing) return existing;
    const [created] = await db.insert(basicdata_versions).values({ user_id: userId }).onConflictDoNothing().returning();
    if (created) return created;
    const [row] = await db.select().from(basicdata_versions).where(eq(basicdata_versions.user_id, userId));
    return row ?? null;
  }

  async get(userId: string): Promise<Record<string, unknown>> {
    const db = this.db.getDb();
    if (!db) return {};
    const [row] = await db.select({ basicdata: users.basicdata }).from(users).where(eq(users.id, userId));
    return (row?.basicdata as Record<string, unknown>) ?? {};
  }

  async history(userId: string): Promise<BasicDataHistoryEntry[]> {
    const db = this.db.getDb();
    if (!db) return [];
    const row = await this.row(db, userId);
    return (row?.history as BasicDataHistoryEntry[] | undefined) ?? [];
  }

  /** The pending change request awaiting review, if any — only ever the most recent entry. */
  async pending(userId: string): Promise<BasicDataHistoryEntry | null> {
    const entries = await this.history(userId);
    const last = entries[entries.length - 1];
    return last?.status === 'changerequested' ? last : null;
  }

  private async appendEntry(
    db: Db,
    userId: string,
    partial: {
      status: BasicDataStatus;
      data: Record<string, unknown>;
      requested_by_user_id: string;
      reviewed_by_user_id: string | null;
      reviewed_at: string | null;
    },
  ): Promise<BasicDataHistoryEntry> {
    const row = await this.row(db, userId);
    const history = ((row?.history as BasicDataHistoryEntry[] | undefined) ?? []).slice();
    const entry: BasicDataHistoryEntry = {
      version: (row?.version_nr ?? 0) + 1,
      status: partial.status,
      data: partial.data,
      requested_by_user_id: partial.requested_by_user_id,
      requested_at: new Date().toISOString(),
      reviewed_by_user_id: partial.reviewed_by_user_id,
      reviewed_at: partial.reviewed_at,
      note: null,
    };
    history.push(entry);
    await db
      .update(basicdata_versions)
      .set({ version_nr: entry.version, history, lastmodified: sql`now()`, lastmodified_by_user_id: partial.requested_by_user_id })
      .where(eq(basicdata_versions.user_id, userId));
    return entry;
  }

  /** Admin/HR direct edit: merges `patch` into users.basicdata immediately and records an already-approved entry. */
  async applyDirectEdit(userId: string, patch: Record<string, unknown>, actorUserId: string): Promise<void> {
    const db = this.db.getDb();
    if (!db) return;
    await db.update(users).set({ basicdata: sql`${users.basicdata} || ${JSON.stringify(patch)}::jsonb` }).where(eq(users.id, userId));
    await this.appendEntry(db, userId, { status: 'approved', data: patch, requested_by_user_id: actorUserId, reviewed_by_user_id: actorUserId, reviewed_at: new Date().toISOString() });
  }

  /** Employee self-service: records a 'changerequested' entry without touching users.basicdata yet. */
  async requestChange(userId: string, patch: Record<string, unknown>, actorUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const db = this.db.getDb();
    if (!db) return { ok: false, error: 'offline' };
    if (await this.pending(userId)) return { ok: false, error: 'request-already-pending' };
    await this.appendEntry(db, userId, { status: 'changerequested', data: patch, requested_by_user_id: actorUserId, reviewed_by_user_id: null, reviewed_at: null });
    return { ok: true };
  }

  /** Admin/HR resolves the pending request: approving merges its data into users.basicdata, rejecting leaves it untouched. */
  async resolveRequest(
    userId: string,
    versionNr: number,
    outcome: 'approved' | 'rejected',
    actorUserId: string,
    note: string | null,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const db = this.db.getDb();
    if (!db) return { ok: false, error: 'offline' };
    const row = await this.row(db, userId);
    const history = ((row?.history as BasicDataHistoryEntry[] | undefined) ?? []).slice();
    const idx = history.findIndex((e) => e.version === versionNr);
    if (idx === -1 || history[idx].status !== 'changerequested') return { ok: false, error: 'not-found' };

    const now = new Date().toISOString();
    history[idx] = { ...history[idx], status: outcome, reviewed_by_user_id: actorUserId, reviewed_at: now, note };
    await db
      .update(basicdata_versions)
      .set({ history, lastmodified: sql`now()`, lastmodified_by_user_id: actorUserId })
      .where(eq(basicdata_versions.user_id, userId));

    if (outcome === 'approved') {
      await db.update(users).set({ basicdata: sql`${users.basicdata} || ${JSON.stringify(history[idx].data)}::jsonb` }).where(eq(users.id, userId));
    }
    return { ok: true };
  }

  /** Every active member of the org with a change request awaiting review — the admin/HR review queue. */
  async pendingForOrg(orgId: string): Promise<Array<{ user_id: string; display_name: string; email: string; entry: BasicDataHistoryEntry }>> {
    const db = this.db.getDb();
    if (!db) return [];
    const result = await db.execute(sql`
      SELECT m.user_id, u.display_name, u.email,
             bv.history -> (jsonb_array_length(bv.history) - 1) AS latest_entry
      FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
      JOIN basicdata_versions bv ON bv.user_id = m.user_id
      WHERE m.organization_id = ${orgId} AND m.status = 'active'
        AND jsonb_array_length(bv.history) > 0
        AND (bv.history -> (jsonb_array_length(bv.history) - 1) ->> 'status') = 'changerequested'
    `);
    return result.rows.map((r: Record<string, unknown>) => ({
      user_id: r.user_id as string,
      display_name: r.display_name as string,
      email: r.email as string,
      entry: r.latest_entry as BasicDataHistoryEntry,
    }));
  }
}
