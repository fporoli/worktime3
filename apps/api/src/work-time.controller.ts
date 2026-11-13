import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gte, inArray, isNull, lt } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { WorkTimeService } from './work-time.service';
import { VersionsService } from './versions.service';
import { callerUserId, canEditUserData, canSeeUserData, editableUserIds, isOrgMember, isPeriodLocked, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { organization_memberships, users, work_times } from './db/schema';

/** The permission object behind each page's time records (`time-record-people?kind=`). */
export const TIME_RECORD_OBJECTS: Record<string, string> = {
  workTime: 'nav.workTime',
  time: 'nav.time',
  timesheet: 'nav.timesheet',
  projectTimesheet: 'nav.projectTimesheet',
};

@Controller()
export class WorkTimeController {
  constructor(
    private readonly db: DbService,
    private readonly wt: WorkTimeService,
    private readonly versions: VersionsService,
  ) {}

  /** Starts a new session. Only one may be open (no `check_out`) per person at a time, across every org. */
  @Post('organizations/:orgId/work-time/check-in')
  async checkIn(@Param('orgId') orgId: string, @Body() body: { comment?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };

    const now = new Date().toISOString();
    if (await isPeriodLocked(db, orgId, userId, now)) return { ok: false, error: 'period-locked' };

    const open = await this.findOpenSession(db, userId);
    if (open) return { ok: false, error: 'already-checked-in' };

    const values = { user_id: userId, organization_id: orgId, check_in: now, comment: body.comment ?? null };
    const [row] = await db.insert(work_times).values(values).returning({ id: work_times.id });
    void this.versions.record('work_times', row.id, 'insert', userId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id, checkIn: now };
  }

  /** Closes the caller's one open session, wherever it is — no org param needed. */
  @Post('work-time/check-out')
  async checkOut(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };

    const open = await this.findOpenSession(db, userId);
    if (!open) return { ok: false, error: 'not-checked-in' };

    const now = new Date().toISOString();
    const patch = { check_out: now };
    await db.update(work_times).set(patch).where(eq(work_times.id, open.id));
    void this.versions.record('work_times', open.id, 'update_delta', userId, patch).catch(() => {});
    return { ok: true, id: open.id, checkOut: now };
  }

  /** The caller's currently-open session, if any — drives the frontend button's initial state. */
  @Get('work-time/status')
  async status(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return null;
    return this.findOpenSession(db, userId);
  }

  /**
   * A completed entry added by hand (a forgotten check-in, a correction): by the person, their
   * designated manager or HR (`nav.workTime` edit beyond own), only while the month is open.
   */
  @Post('organizations/:orgId/users/:userId/work-time')
  async addEntry(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() body: { checkIn?: string; checkOut?: string; comment?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, targetUserId))) return { ok: false, error: 'unknown-user' };
    if (!(await canEditUserData(db, orgId, callerId, 'nav.workTime', targetUserId))) return { ok: false, error: 'forbidden' };
    const checkIn = typeof body.checkIn === 'string' ? body.checkIn : '';
    const checkOut = typeof body.checkOut === 'string' ? body.checkOut : '';
    if (Number.isNaN(Date.parse(checkIn)) || Number.isNaN(Date.parse(checkOut)) || Date.parse(checkOut) <= Date.parse(checkIn)) {
      return { ok: false, error: 'invalid-range' };
    }
    if (await isPeriodLocked(db, orgId, targetUserId, checkIn)) return { ok: false, error: 'period-locked' };
    const values = { user_id: targetUserId, organization_id: orgId, check_in: checkIn, check_out: checkOut, comment: body.comment?.trim() || null };
    const [row] = await db.insert(work_times).values(values).returning({ id: work_times.id });
    void this.versions.record('work_times', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  /**
   * The people whose time records the caller may change on a page (`kind`: work time, project
   * time, or either monthly timesheet): themselves, their direct reports, and whoever an edit
   * grant beyond own covers (HR: everyone). Drives the person picker on those pages.
   */
  @Get('organizations/:orgId/time-record-people')
  async timeRecordPeople(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('kind') kind?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', people: [] };
    const object = TIME_RECORD_OBJECTS[kind ?? ''];
    if (!object) return { ok: false, error: 'invalid-kind', people: [] };
    const ids = await editableUserIds(db, orgId, callerId, object);
    const conditions = [eq(organization_memberships.organization_id, orgId), eq(organization_memberships.status, 'active')];
    if (ids !== 'all') conditions.push(inArray(organization_memberships.user_id, [...ids]));
    const rows = await db
      .select({ id: users.id, name: users.display_name, email: users.email })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(...conditions))
      .orderBy(asc(users.display_name));
    return { ok: true, people: rows };
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

    let targetUserId = userId;
    if (targetUserId && targetUserId !== callerId) {
      if (!(await canSeeUserData(db, orgId, callerId, 'nav.workTime', targetUserId))) {
        return { entries: [], summary: {} };
      }
    } else if (!targetUserId && !(await reachesAll(db, orgId, callerId, 'nav.workTime'))) {
      // No person asked for: everyone's entries only for grants reaching all; otherwise one's own.
      targetUserId = callerId;
    }

    const conditions = [eq(work_times.organization_id, orgId)];
    if (targetUserId) conditions.push(eq(work_times.user_id, targetUserId));
    if (from) conditions.push(gte(work_times.check_in, from));
    if (to) conditions.push(lt(work_times.check_in, to));

    const rows = await db
      .select(getTableColumns(work_times))
      .from(work_times)
      .where(and(...conditions))
      .orderBy(asc(work_times.check_in));

    const closed = rows.filter((r) => r.check_out);
    const summary = this.wt.bucket(
      closed.map((r) => ({ startTime: r.check_in, endTime: r.check_out as string })),
      view ?? 'daily',
    );
    return { entries: rows, summary };
  }

  @Patch('work-time/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { checkIn?: string; checkOut?: string | null; comment?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;

    if (body.checkIn !== undefined && body.checkIn !== owned.entry.check_in && owned.entry.organization_id) {
      if (await isPeriodLocked(db, owned.entry.organization_id, owned.entry.user_id, body.checkIn)) {
        return { ok: false, error: 'period-locked' };
      }
    }

    const patch: Partial<typeof work_times.$inferInsert> = {};
    if (body.checkIn !== undefined) patch.check_in = body.checkIn;
    if (body.checkOut !== undefined) patch.check_out = body.checkOut;
    if (body.comment !== undefined) patch.comment = body.comment;
    if (Object.keys(patch).length === 0) return { ok: true };
    await db.update(work_times).set(patch).where(eq(work_times.id, id));
    void this.versions.record('work_times', id, 'update_delta', owned.userId, patch).catch(() => {});
    return { ok: true };
  }

  @Delete('work-time/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;
    await db.delete(work_times).where(eq(work_times.id, id));
    void this.versions.record('work_times', id, 'delete', owned.userId, owned.entry).catch(() => {});
    return { ok: true };
  }

  private async findOpenSession(db: Db, userId: string) {
    const [row] = await db
      .select(getTableColumns(work_times))
      .from(work_times)
      .where(and(eq(work_times.user_id, userId), isNull(work_times.check_out)));
    return row ?? null;
  }

  /**
   * Entries are editable by the person they belong to, their designated manager and HR
   * (`nav.workTime` edit beyond own), and only outside a submitted/approved timesheet period:
   * a locked month has to be reopened first. Returns `{error}` when disallowed,
   * or the entry (plus caller id) when the edit may proceed.
   */
  private async assertEditableEntry(
    db: Db,
    id: string,
    req: AuthenticatedRequest,
  ): Promise<
    | { ok: false; error: string }
    | { userId: string; entry: { user_id: string; organization_id: string | null; check_in: string; check_out: string | null } }
  > {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const [row] = await db
      .select({ user_id: work_times.user_id, organization_id: work_times.organization_id, check_in: work_times.check_in, check_out: work_times.check_out })
      .from(work_times)
      .where(eq(work_times.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId && !(row.organization_id && (await canEditUserData(db, row.organization_id, userId, 'nav.workTime', row.user_id)))) {
      return { ok: false, error: 'forbidden' };
    }
    if (row.organization_id && (await isPeriodLocked(db, row.organization_id, row.user_id, row.check_in))) {
      return { ok: false, error: 'period-locked' };
    }
    return { userId, entry: row };
  }
}
