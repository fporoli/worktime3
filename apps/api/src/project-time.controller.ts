import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gt, gte, lt, ne, type SQL } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { ProjectTimeService } from './project-time.service';
import { VersionsService } from './versions.service';
import { WorkTimeModelService } from './work-time-model.service';
import { callerUserId, canEditUserData, canSeeUserData, isOrgMember, isProjectPeriodLocked, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { project_times, projects, subprojects, users } from './db/schema';

@Controller()
export class ProjectTimeController {
  constructor(
    private readonly db: DbService,
    private readonly wt: ProjectTimeService,
    private readonly versions: VersionsService,
    private readonly workTime: WorkTimeModelService,
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
      /** Set once the user has seen the "more project time than working time" warning and chose to add it anyway. */
      acknowledgeAttendance?: boolean;
      /** Whose entry it is: the caller by default; someone else only for their manager or HR. */
      userId?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    // The caller's own entry unless another person is named; that needs their manager or an
    // edit grant beyond own (HR), checked against the caller's real identity.
    const userId = body.userId || callerId;
    if (userId !== callerId) {
      if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'unknown-user' };
      if (!(await canEditUserData(db, orgId, callerId, 'nav.time', userId))) return { ok: false, error: 'forbidden' };
    }
    // Project time is locked per project and month by the project timesheet, not by the working-time one.
    if (await isProjectPeriodLocked(db, orgId, userId, body.projectId, body.startTime)) return { ok: false, error: 'period-locked' };
    // Only "ranges" users care about overlap at all — everyone else logs duration-only entries that
    // are expected to share the same 08:00 start, so there's nothing to warn about.
    if (await this.usesProjectTimeRanges(db, userId)) {
      const overlaps = await this.findOverlaps(db, userId, orgId, body.startTime, body.endTime);
      if (overlaps.length > 0 && !body.acknowledgeOverlap) {
        return { ok: false, error: 'overlapping-entry-confirm', overlaps };
      }
    }
    // Project time and attendance are recorded separately, but a day's project time should not
    // exceed that day's attendance (plus the organization's tolerance): warn, and save on confirmation.
    if (!body.acknowledgeAttendance) {
      const check = await this.workTime.checkProjectTime(db, orgId, userId, body.startTime, body.endTime);
      if (!check.ok) return { ...check, error: 'project-exceeds-attendance-confirm' };
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
    void this.versions.record('project_times', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
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

    let targetUserId = userId;
    if (targetUserId && targetUserId !== callerId) {
      if (!(await canSeeUserData(db, orgId, callerId, 'nav.time', targetUserId))) {
        return { entries: [], summary: {} };
      }
    } else if (!targetUserId && !(await reachesAll(db, orgId, callerId, 'nav.time'))) {
      // No person asked for: everyone's entries only for grants reaching all; otherwise one's own.
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
      /** Set once the user has seen the "more project time than working time" warning and chose to keep it anyway. */
      acknowledgeAttendance?: boolean;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;

    // A locked project month can't be edited into either: check where the entry ends up, not just where it is.
    const targetProject = body.projectId !== undefined ? body.projectId || null : owned.entry.project_id;
    const targetStart = body.startTime ?? owned.entry.start_time;
    if (owned.entry.organization_id && (targetProject !== owned.entry.project_id || targetStart !== owned.entry.start_time)) {
      if (await isProjectPeriodLocked(db, owned.entry.organization_id, owned.userId, targetProject, targetStart)) {
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

    if ((body.startTime !== undefined || body.endTime !== undefined) && owned.entry.organization_id && !body.acknowledgeAttendance) {
      const check = await this.workTime.checkProjectTime(
        db,
        owned.entry.organization_id,
        owned.userId,
        body.startTime ?? owned.entry.start_time,
        body.endTime ?? owned.entry.end_time,
        id,
      );
      if (!check.ok) return { ...check, error: 'project-exceeds-attendance-confirm' };
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
    void this.versions.record('project_times', id, 'update_delta', owned.actorId, patch).catch(() => {});
    return { ok: true };
  }

  @Delete('project-time/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;
    await db.delete(project_times).where(eq(project_times.id, id));
    void this.versions.record('project_times', id, 'delete', owned.actorId, { user_id: owned.userId, ...owned.entry }).catch(() => {});
    return { ok: true };
  }

  /**
   * Entries are editable by the person they belong to, their designated manager and HR
   * (`nav.time` edit beyond own), and only outside a submitted/approved project month (project
   * timesheet): a locked month has to be reopened first. Returns `{error}` when disallowed,
   * or the entry with its owner (`userId`) and the caller (`actorId`).
   */
  private async assertEditableEntry(
    db: Db,
    id: string,
    req: AuthenticatedRequest,
  ): Promise<
    | { ok: false; error: string }
    | { userId: string; actorId: string; entry: { organization_id: string | null; project_id: string | null; start_time: string; end_time: string } }
  > {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unknown-user' };
    const [row] = await db
      .select({
        user_id: project_times.user_id,
        organization_id: project_times.organization_id,
        project_id: project_times.project_id,
        start_time: project_times.start_time,
        end_time: project_times.end_time,
      })
      .from(project_times)
      .where(eq(project_times.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== callerId && !(row.organization_id && (await canEditUserData(db, row.organization_id, callerId, 'nav.time', row.user_id)))) {
      return { ok: false, error: 'forbidden' };
    }
    if (row.organization_id && (await isProjectPeriodLocked(db, row.organization_id, row.user_id, row.project_id, row.start_time))) {
      return { ok: false, error: 'period-locked' };
    }
    const { user_id: userId, ...entry } = row;
    return { userId, actorId: callerId, entry };
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
