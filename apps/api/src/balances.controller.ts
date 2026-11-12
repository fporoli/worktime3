import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { ADJUSTMENT_KINDS, BALANCE_KINDS, BalancesService, type AdjustmentKind, type BalanceKind } from './balances.service';
import { callerUserId, canEditBeyondOwn, canSeeUserData, isOrgMember, listableUserIds } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { isIsoDate } from '@worktime3/shared/worktime';

type Db = NonNullable<ReturnType<DbService['getDb']>>;

/** Others' balances are behind the "Time balances" page; one's own are always visible. */
const OBJECT = 'nav.balances';

function parseYear(value: string | undefined): number {
  return /^\d{4}$/.test(value ?? '') ? Number(value) : new Date().getFullYear();
}

@Controller()
export class BalancesController {
  constructor(
    private readonly db: DbService,
    private readonly balances: BalancesService,
  ) {}

  /** Headline numbers for the Home and Work time pages: overtime booked and pending, vacation left this year. */
  @Get('organizations/:orgId/balances')
  async get(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('userId') userId?: string) {
    const db = this.db.getDb();
    if (!db) return null;
    const target = await this.target(db, orgId, req, userId);
    if (!target) return null;
    const year = await this.balances.year(db, orgId, target, new Date().getFullYear());
    return {
      overtimeMinutes: year.overtime.bookedMinutes,
      pendingOvertimeMinutes: year.overtime.pendingMinutes,
      pendingSince: year.overtime.pendingSince,
      vacationDays: year.vacation.remaining,
      vacationPlannedDays: year.vacation.planned,
    };
  }

  /** A person's year: months with target, attendance and balance; vacation; adjustments. */
  @Get('organizations/:orgId/balances/year')
  async year(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('userId') userId?: string, @Query('year') yearParam?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    const target = await this.target(db, orgId, req, userId);
    if (!callerId || !target) return { ok: false, error: 'forbidden' };
    const balances = await this.balances.year(db, orgId, target, parseYear(yearParam));
    return { ok: true, ...balances, canEdit: await canEditBeyondOwn(db, orgId, callerId, OBJECT, target) };
  }

  /** Everyone the caller may see for a month (`YYYY-MM`), with over/under-budget and timesheet alerts. */
  @Get('organizations/:orgId/balances/report')
  async report(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('month') monthParam?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, rows: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', rows: [] };
    if (!/^\d{4}-\d{2}$/.test(monthParam ?? '') || !isIsoDate(`${monthParam}-01`)) return { ok: false, error: 'invalid-month', rows: [] };
    const ids = await listableUserIds(db, orgId, callerId, OBJECT);
    return { ok: true, rows: await this.balances.report(db, orgId, ids, `${monthParam}-01`) };
  }

  /** Books an opening balance, correction or payout (minutes for overtime, days for vacation). */
  @Post('organizations/:orgId/balances/adjustments')
  async addAdjustment(
    @Param('orgId') orgId: string,
    @Body() body: { userId?: string; balance?: string; kind?: string; effectiveDate?: string; amount?: number; note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.userId || !(await canEditBeyondOwn(db, orgId, callerId, OBJECT, body.userId))) return { ok: false, error: 'forbidden' };
    const error = validateAdjustment(body);
    if (error) return { ok: false, error };
    const id = await this.balances.addAdjustment(db, {
      organizationId: orgId,
      userId: body.userId,
      balance: body.balance as BalanceKind,
      kind: body.kind as AdjustmentKind,
      effectiveDate: body.effectiveDate as string,
      amount: body.amount as number,
      note: body.note?.trim() || null,
      actorUserId: callerId,
    });
    return { ok: true, id };
  }

  @Delete('organizations/:orgId/balances/adjustments/:id')
  async deleteAdjustment(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'not-found' };
    const row = await this.balances.findAdjustment(db, id);
    if (!row || row.organization_id !== orgId) return { ok: false, error: 'not-found' };
    if (!(await canEditBeyondOwn(db, orgId, callerId, OBJECT, row.user_id))) return { ok: false, error: 'forbidden' };
    await this.balances.deleteAdjustment(db, id, callerId);
    return { ok: true };
  }

  /** A person's vacation days for a year; `days: null` returns to the organization's default. */
  @Put('organizations/:orgId/balances/entitlements')
  async setEntitlement(
    @Param('orgId') orgId: string,
    @Body() body: { userId?: string; year?: number; days?: number | null; note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.userId || !(await canEditBeyondOwn(db, orgId, callerId, OBJECT, body.userId))) return { ok: false, error: 'forbidden' };
    if (!Number.isInteger(body.year) || (body.year as number) < 2000 || (body.year as number) > 2100) return { ok: false, error: 'invalid-year' };
    const days = body.days ?? null;
    if (days !== null && !(typeof days === 'number' && Number.isFinite(days) && days >= 0 && days <= 366)) return { ok: false, error: 'invalid-days' };
    await this.balances.setEntitlement(db, orgId, body.userId, body.year as number, days === null ? null : Math.round(days * 100) / 100, body.note?.trim() || null, callerId);
    return { ok: true };
  }

  /** The caller, or someone whose data they may see on the balances page (manager: their reports). */
  private async target(db: Db, orgId: string, req: AuthenticatedRequest, userId: string | undefined): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return null;
    if (!userId || userId === callerId) return callerId;
    return (await canSeeUserData(db, orgId, callerId, OBJECT, userId)) ? userId : null;
  }
}

/** Error code for an invalid adjustment, or null. */
export function validateAdjustment(body: { balance?: string; kind?: string; effectiveDate?: string; amount?: number }): string | null {
  if (!(BALANCE_KINDS as readonly string[]).includes(body.balance ?? '')) return 'invalid-balance';
  if (!(ADJUSTMENT_KINDS as readonly string[]).includes(body.kind ?? '')) return 'invalid-kind';
  if (!isIsoDate(body.effectiveDate)) return 'invalid-date';
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) return 'invalid-amount';
  const limit = body.balance === 'vacation' ? 1000 : 100000 * 60;
  if (Math.abs(amount) > limit) return 'invalid-amount';
  return null;
}
