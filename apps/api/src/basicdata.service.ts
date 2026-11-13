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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Moves an org's custom fields into that org's section of users.basicdata (docs/FIELD_CONFIG.md,
 * "Storing custom JSON fields"): `{ placeOfBirth }` becomes `{ orgs: { <orgId>: { placeOfBirth } } }`.
 */
export function nestOrgKeys(patch: Record<string, unknown>, orgKeys: readonly string[], orgId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const section: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (orgKeys.includes(key)) section[key] = value;
    else out[key] = value;
  }
  if (Object.keys(section).length > 0) out.orgs = { [orgId]: section };
  return out;
}

/**
 * Basic data as one org sees it: built-in and global keys, plus that org's own section flattened
 * in. Other orgs' sections are dropped, so one org's custom data never reaches another.
 */
export function scopeToOrg(data: Record<string, unknown>, orgId: string): Record<string, unknown> {
  const { orgs, ...rest } = data;
  const own = isPlainObject(orgs) ? orgs[orgId] : undefined;
  return isPlainObject(own) ? { ...rest, ...own } : rest;
}

/** Keeps only `orgId`'s section of a stored patch, e.g. when that org's HR approves a request. */
export function keepOrgSection(data: Record<string, unknown>, orgId: string): Record<string, unknown> {
  const { orgs, ...rest } = data;
  const own = isPlainObject(orgs) ? orgs[orgId] : undefined;
  return isPlainObject(own) ? { ...rest, orgs: { [orgId]: own } } : rest;
}

/**
 * SQL that merges a patch into users.basicdata. Top-level keys replace, as before; each org's
 * section under `orgs` is merged key by key, so saving one org's fields keeps the others.
 */
function mergedBasicdata(patch: Record<string, unknown>) {
  const { orgs, ...flat } = patch;
  let expr = sql`COALESCE(${users.basicdata}, '{}'::jsonb) || ${JSON.stringify(flat)}::jsonb`;
  for (const [orgId, section] of Object.entries(isPlainObject(orgs) ? orgs : {})) {
    expr = sql`jsonb_set(${expr}, '{orgs}',
      COALESCE(${users.basicdata} -> 'orgs', '{}'::jsonb)
      || jsonb_build_object(${orgId}::text, COALESCE(${users.basicdata} -> 'orgs' -> ${orgId}::text, '{}'::jsonb) || ${JSON.stringify(section)}::jsonb))`;
  }
  return expr;
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
    await db.update(users).set({ basicdata: mergedBasicdata(patch) }).where(eq(users.id, userId));
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

  /**
   * Admin/HR resolves the pending request: approving merges its data into users.basicdata, rejecting
   * leaves it untouched. Only the reviewing org's own custom-field section is applied. Keys stored
   * in real `users` columns (`userColumns`: key -> column, e.g. firstName -> first_name) go there.
   */
  async resolveRequest(
    userId: string,
    versionNr: number,
    outcome: 'approved' | 'rejected',
    actorUserId: string,
    note: string | null,
    orgId?: string,
    userColumns: Record<string, string> = {},
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
      const data = orgId ? keepOrgSection(history[idx].data, orgId) : history[idx].data;
      const columns: Record<string, unknown> = {};
      const json: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (userColumns[key]) columns[userColumns[key]] = value;
        else json[key] = value;
      }
      await db.update(users).set({ ...columns, basicdata: mergedBasicdata(json) }).where(eq(users.id, userId));
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
