import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gt, gte, lt, ne, type SQL } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { ProjectTimeService } from './project-time.service';
import { VersionsService } from './versions.service';
import { callerUserId, isManagerOf, isOrgAdmin, isOrgMember, isPeriodLocked } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { project_times, projects, subprojects, users } from './db/schema';

@Controller()
export class ProjectTimeController {
  constructor(
    private readonly db: DbService,
    private readonly wt: ProjectTimeService,
    private readonly versions: VersionsService,
  ) {}

  @Post('organizations/:orgId/project-time')
  async create(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      projectId?: string;
      subprojectId?: string;
      startTime: string;
      endTime: string;
      comment?: string;
      /** Set once the user has seen the overlap warning and chose to add it anyway. */
      acknowledgeOverlap?: boolean;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    // The entry always belongs to the caller — never trust a client-supplied user id.
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };
    if (await isPeriodLocked(db, orgId, userId, body.startTime)) return { ok: false, error: 'period-locked' };
    // Only "ranges" users care about overlap at all — everyone else logs duration-only entries that
    // are expected to share the same 08:00 start, so there's nothing to warn about.
    if (await this.usesProjectTimeRanges(db, userId)) {
      const overlaps = await this.findOverlaps(db, userId, orgId, body.startTime, body.endTime);
      if (overlaps.length > 0 && !body.acknowledgeOverlap) {
        return { ok: false, error: 'overlapping-entry-confirm', overlaps };
      }
    }
    const values = {
      user_id: userId,
      organization_id: orgId,
      project_id: body.projectId ?? null,
      subproject_id: body.subprojectId ?? null,
      start_time: body.startTime,
      end_time: body.endTime,
      comment: body.comment ?? null,
    };
    const [row] = await db.insert(project_times).values(values).returning({ id: project_times.id });
    void this.versions.record('project_times', row.id, 'insert', userId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Get('organizations/:orgId/project-time')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('view') view?: 'daily' | 'weekly' | 'monthly',
  ) {
    const db = this.db.getDb();
    if (!db) return { entries: [], summary: {} };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { entries: [], summary: {} };

    const isAdmin = await isOrgAdmin(db, orgId, callerId);
    let targetUserId = userId;
    if (targetUserId && targetUserId !== callerId) {
      if (!isAdmin && !(await isManagerOf(db, orgId, callerId, targetUserId))) {
        return { entries: [], summary: {} };
      }
    } else if (!targetUserId && !isAdmin) {
      targetUserId = callerId;
    }

    const conditions: SQL[] = [eq(project_times.organization_id, orgId)];
    if (targetUserId) conditions.push(eq(project_times.user_id, targetUserId));
    if (from) conditions.push(gte(project_times.start_time, from));
    if (to) conditions.push(lt(project_times.start_time, to));


    // Names come along so the UI can list entries without a lookup per row.
    const rows = await db
      .select({
        ...getTableColumns(project_times),
        project_name: projects.name,
        subproject_name: subprojects.name,
      })
      .from(project_times)
      .leftJoin(projects, eq(projects.id, project_times.project_id))
      .leftJoin(subprojects, eq(subprojects.id, project_times.subproject_id))
      .where(and(...conditions))
      .orderBy(asc(project_times.start_time));

    const summary = this.wt.bucket(
      rows.map((r) => ({ startTime: r.start_time, endTime: r.end_time })),
      view ?? 'daily',
    );
    return { entries: rows, summary };
  }

  @Patch('project-time/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      projectId?: string | null;
      subprojectId?: string | null;
      startTime?: string;
      endTime?: string;
      comment?: string;
      /** Set once the user has seen the overlap warning and chose to keep it anyway. */
      acknowledgeOverlap?: boolean;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;

    // A locked month can't be edited into either — check the target date too, not just the entry's current one.
    if (body.startTime !== undefined && body.startTime !== owned.entry.start_time && owned.entry.organization_id) {
      if (await isPeriodLocked(db, owned.entry.organization_id, owned.userId, body.startTime)) {
        return { ok: false, error: 'period-locked' };
      }
    }

    if ((body.startTime !== undefined || body.endTime !== undefined) && owned.entry.organization_id && (await this.usesProjectTimeRanges(db, owned.userId))) {
      const effectiveStart = body.startTime ?? owned.entry.start_time;
      const effectiveEnd = body.endTime ?? owned.entry.end_time;
      const overlaps = await this.findOverlaps(db, owned.userId, owned.entry.organization_id, effectiveStart, effectiveEnd, id);
      if (overlaps.length > 0 && !body.acknowledgeOverlap) {
        return { ok: false, error: 'overlapping-entry-confirm', overlaps };
      }
    }

    const patch: Partial<typeof project_times.$inferInsert> = {};
    if (body.projectId !== undefined) patch.project_id = body.projectId || null;
    if (body.subprojectId !== undefined) patch.subproject_id = body.subprojectId || null;
    if (body.startTime !== undefined) patch.start_time = body.startTime;
    if (body.endTime !== undefined) patch.end_time = body.endTime;
    if (body.comment !== undefined) patch.comment = body.comment;
    if (Object.keys(patch).length === 0) return { ok: true };
    // One statement: start/end move together, so chk_project_time_order never sees a half-applied edit.
    await db.update(project_times).set(patch).where(eq(project_times.id, id));
    void this.versions.record('project_times', id, 'update_delta', owned.userId, patch).catch(() => {});
    return { ok: true };
  }

  @Delete('project-time/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;
    await db.delete(project_times).where(eq(project_times.id, id));
    void this.versions.record('project_times', id, 'delete', owned.userId, owned.entry).catch(() => {});
    return { ok: true };
  }

  /**
   * Entries are only editable by the user they belong to, and only outside a
   * submitted/approved timesheet period. Returns `{error}` when disallowed,
   * or the entry (plus caller id) when the edit may proceed.
   */
  private async assertEditableEntry(
    db: Db,
    id: string,
    req: AuthenticatedRequest,
  ): Promise<
    | { ok: false; error: string }
    | { userId: string; entry: { organization_id: string | null; start_time: string; end_time: string } }
  > {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const [row] = await db
      .select({
        user_id: project_times.user_id,
        organization_id: project_times.organization_id,
        start_time: project_times.start_time,
        end_time: project_times.end_time,
      })
      .from(project_times)
      .where(eq(project_times.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId) return { ok: false, error: 'forbidden' };
    if (row.organization_id && (await isPeriodLocked(db, row.organization_id, userId, row.start_time))) {
      return { ok: false, error: 'period-locked' };
    }
    return { userId, entry: row };
  }

  /** Whether this user wants strict, non-overlapping start/end ranges (a per-user preference). */
  private async usesProjectTimeRanges(db: Db, userId: string): Promise<boolean> {
    const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
    return (row?.settings as { useProjectTimeMinutesRanges?: boolean } | null)?.useProjectTimeMinutesRanges === true;
  }

  /** This user's other entries in the same organization overlapping [startTime, endTime), if any. */
  private async findOverlaps(db: Db, userId: string, orgId: string, startTime: string, endTime: string, excludeId?: string) {
    const conditions = [
      eq(project_times.user_id, userId),
      eq(project_times.organization_id, orgId),
      lt(project_times.start_time, endTime),
      gt(project_times.end_time, startTime),
    ];
    if (excludeId) conditions.push(ne(project_times.id, excludeId));
    return db
      .select({ id: project_times.id, start_time: project_times.start_time, end_time: project_times.end_time, comment: project_times.comment })
      .from(project_times)
      .where(and(...conditions))
      .limit(5);
  }
}
