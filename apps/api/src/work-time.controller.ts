import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gte, isNull, lt } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { WorkTimeService } from './work-time.service';
import { VersionsService } from './versions.service';
import { callerUserId, isManagerOf, isOrgAdmin, isOrgMember, isPeriodLocked } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { work_times } from './db/schema';

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

    const isAdmin = await isOrgAdmin(db, orgId, callerId);
    let targetUserId = userId;
    if (targetUserId && targetUserId !== callerId) {
      if (!isAdmin && !(await isManagerOf(db, orgId, callerId, targetUserId))) {
        return { entries: [], summary: {} };
      }
    } else if (!targetUserId && !isAdmin) {
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
      if (await isPeriodLocked(db, owned.entry.organization_id, owned.userId, body.checkIn)) {
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
    | { userId: string; entry: { organization_id: string | null; check_in: string; check_out: string | null } }
  > {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const [row] = await db
      .select({ user_id: work_times.user_id, organization_id: work_times.organization_id, check_in: work_times.check_in, check_out: work_times.check_out })
      .from(work_times)
      .where(eq(work_times.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId) return { ok: false, error: 'forbidden' };
    if (row.organization_id && (await isPeriodLocked(db, row.organization_id, userId, row.check_in))) {
      return { ok: false, error: 'period-locked' };
    }
    return { userId, entry: row };
  }
}
