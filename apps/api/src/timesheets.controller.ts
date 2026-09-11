import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { and, desc, eq, getTableColumns, type SQL } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin, isOrgManagerOrAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { timesheet_periods, users } from './db/schema';
import { AuditService } from './audit.service';

const STATUSES = ['open', 'submitted', 'approved', 'rejected'] as const;
type Status = (typeof STATUSES)[number];

/** First day of the month after `periodStart` (a 'YYYY-MM-01' string) — the period's exclusive end. */
export function nextMonthStart(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

@Controller()
export class TimesheetsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get('organizations/:orgId/timesheet-periods')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];

    const isManager = await isOrgManagerOrAdmin(db, orgId, callerId);
    // Non-managers only ever see their own periods; managers can see anyone's (e.g. ?status=submitted for a queue).
    const targetUserId = userId ?? (isManager ? undefined : callerId);
    if (targetUserId && targetUserId !== callerId && !isManager) return [];

    const conditions: SQL[] = [eq(timesheet_periods.organization_id, orgId)];
    if (targetUserId) conditions.push(eq(timesheet_periods.user_id, targetUserId));
    if (status && (STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(timesheet_periods.status, status as Status));
    }

    return db
      .select({
        ...getTableColumns(timesheet_periods),
        user_display_name: users.display_name,
        user_email: users.email,
      })
      .from(timesheet_periods)
      .innerJoin(users, eq(users.id, timesheet_periods.user_id))
      .where(and(...conditions))
      .orderBy(desc(timesheet_periods.period_start));
  }

  @Post('organizations/:orgId/timesheet-periods/submit')
  async submit(
    @Param('orgId') orgId: string,
    @Body() body: { periodStart: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const periodStart = (body.periodStart ?? '').trim();
    if (!/^\d{4}-\d{2}-01$/.test(periodStart)) return { ok: false, error: 'invalid-period-start' };

    const [existing] = await db
      .select({ id: timesheet_periods.id, status: timesheet_periods.status })
      .from(timesheet_periods)
      .where(
        and(
          eq(timesheet_periods.organization_id, orgId),
          eq(timesheet_periods.user_id, callerId),
          eq(timesheet_periods.period_start, periodStart),
        ),
      );
    if (existing && (existing.status === 'submitted' || existing.status === 'approved')) {
      return { ok: false, error: 'already-submitted' };
    }

    const now = new Date().toISOString();
    if (existing) {
      await db
        .update(timesheet_periods)
        .set({ status: 'submitted', submitted_at: now, reviewed_by_user_id: null, reviewed_at: null, review_note: null, updated_at: now })
        .where(eq(timesheet_periods.id, existing.id));
      void this.audit.record(orgId, callerId, 'timesheet.submit', 'timesheet_period', existing.id, { periodStart }).catch(() => {});
      return { ok: true, id: existing.id };
    }
    const [created] = await db
      .insert(timesheet_periods)
      .values({
        organization_id: orgId,
        user_id: callerId,
        period_start: periodStart,
        period_end: nextMonthStart(periodStart),
        status: 'submitted',
        submitted_at: now,
      })
      .returning({ id: timesheet_periods.id });
    void this.audit.record(orgId, callerId, 'timesheet.submit', 'timesheet_period', created.id, { periodStart }).catch(() => {});
    return { ok: true, id: created.id };
  }

  @Post('timesheet-periods/:id/approve')
  async approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.review(id, req, 'approved');
  }

  @Post('timesheet-periods/:id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    return this.review(id, req, 'rejected', body?.note);
  }

  private async review(
    id: string,
    req: AuthenticatedRequest,
    newStatus: 'approved' | 'rejected',
    note?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, status: timesheet_periods.status })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, id));
    if (!period) return { ok: false, error: 'period-not-found' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(db, period.organization_id, callerId))) return { ok: false, error: 'forbidden' };
    if (period.status !== 'submitted') return { ok: false, error: 'not-submitted' };
    await db
      .update(timesheet_periods)
      .set({
        status: newStatus,
        reviewed_by_user_id: callerId,
        reviewed_at: new Date().toISOString(),
        review_note: note?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(timesheet_periods.id, id));
    void this.audit
      .record(period.organization_id, callerId, `timesheet.${newStatus === 'approved' ? 'approve' : 'reject'}`, 'timesheet_period', id, note ? { note } : undefined)
      .catch(() => {});
    return { ok: true };
  }

  /** Admin-only undo: an approved period can be reopened for correction. */
  @Post('timesheet-periods/:id/reopen')
  async reopen(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, status: timesheet_periods.status })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, id));
    if (!period) return { ok: false, error: 'period-not-found' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, period.organization_id, callerId))) return { ok: false, error: 'forbidden' };
    if (period.status !== 'approved') return { ok: false, error: 'not-approved' };
    await db
      .update(timesheet_periods)
      .set({ status: 'open', reviewed_by_user_id: null, reviewed_at: null, review_note: null, updated_at: new Date().toISOString() })
      .where(eq(timesheet_periods.id, id));
    void this.audit.record(period.organization_id, callerId, 'timesheet.reopen', 'timesheet_period', id).catch(() => {});
    return { ok: true };
  }
}
