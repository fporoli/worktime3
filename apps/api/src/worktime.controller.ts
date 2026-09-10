import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gte, lt, type SQL } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { WorktimeService } from './worktime.service';
import { callerUserId, isOrgMember, isPeriodLocked } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { work_times, projects, subprojects } from './db/schema';

@Controller()
export class WorktimeController {
  constructor(
    private readonly db: DbService,
    private readonly wt: WorktimeService,
  ) {}

  @Post('organizations/:orgId/work-time')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { projectId?: string; subprojectId?: string; startTime: string; endTime: string; comment?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    // The entry always belongs to the caller — never trust a client-supplied user id.
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };
    if (await isPeriodLocked(db, orgId, userId, body.startTime)) return { ok: false, error: 'period-locked' };
    const [row] = await db
      .insert(work_times)
      .values({
        user_id: userId,
        organization_id: orgId,
        project_id: body.projectId ?? null,
        subproject_id: body.subprojectId ?? null,
        start_time: body.startTime,
        end_time: body.endTime,
        comment: body.comment ?? null,
      })
      .returning({ id: work_times.id });
    return { ok: true, id: row.id };
  }

  @Get('organizations/:orgId/work-time')
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
    const conditions: SQL[] = [eq(work_times.organization_id, orgId)];
    if (userId) conditions.push(eq(work_times.user_id, userId));
    if (from) conditions.push(gte(work_times.start_time, from));
    if (to) conditions.push(lt(work_times.start_time, to));

    // Names come along so the UI can list entries without a lookup per row.
    const rows = await db
      .select({
        ...getTableColumns(work_times),
        project_name: projects.name,
        subproject_name: subprojects.name,
      })
      .from(work_times)
      .leftJoin(projects, eq(projects.id, work_times.project_id))
      .leftJoin(subprojects, eq(subprojects.id, work_times.subproject_id))
      .where(and(...conditions))
      .orderBy(asc(work_times.start_time));

    const summary = this.wt.bucket(
      rows.map((r) => ({ startTime: r.start_time, endTime: r.end_time })),
      view ?? 'daily',
    );
    return { entries: rows, summary };
  }

  @Patch('work-time/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      projectId?: string | null;
      subprojectId?: string | null;
      startTime?: string;
      endTime?: string;
      comment?: string;
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

    const patch: Partial<typeof work_times.$inferInsert> = {};
    if (body.projectId !== undefined) patch.project_id = body.projectId || null;
    if (body.subprojectId !== undefined) patch.subproject_id = body.subprojectId || null;
    if (body.startTime !== undefined) patch.start_time = body.startTime;
    if (body.endTime !== undefined) patch.end_time = body.endTime;
    if (body.comment !== undefined) patch.comment = body.comment;
    if (Object.keys(patch).length === 0) return { ok: true };
    // One statement: start/end move together, so chk_worktime_order never sees a half-applied edit.
    patch.updated_at = new Date().toISOString();
    await db.update(work_times).set(patch).where(eq(work_times.id, id));
    return { ok: true };
  }

  @Delete('work-time/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;
    await db.delete(work_times).where(eq(work_times.id, id));
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
    | { userId: string; entry: { organization_id: string | null; start_time: string } }
  > {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const [row] = await db
      .select({ user_id: work_times.user_id, organization_id: work_times.organization_id, start_time: work_times.start_time })
      .from(work_times)
      .where(eq(work_times.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId) return { ok: false, error: 'forbidden' };
    if (row.organization_id && (await isPeriodLocked(db, row.organization_id, userId, row.start_time))) {
      return { ok: false, error: 'period-locked' };
    }
    return { userId, entry: row };
  }
}
