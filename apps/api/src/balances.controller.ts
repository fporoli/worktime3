import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { BalancesService, type BalanceType } from './balances.service';
import { callerUserId, isManagerOf, isOrgAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

const BALANCE_TYPES: BalanceType[] = ['overtime', 'vacation'];

@Controller()
export class BalancesController {
  constructor(
    private readonly db: DbService,
    private readonly balances: BalancesService,
  ) {}

  @Get('organizations/:orgId/balances')
  async get(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('userId') userId?: string) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return null;

    const targetUserId = await this.resolveTargetUserId(db, orgId, callerId, userId);
    if (!targetUserId) return null;

    const row = await this.balances.get(db, orgId, targetUserId);
    return { overtimeMinutes: Number(row.overtime_minutes), vacationMinutes: Number(row.vacation_minutes), updatedAt: row.updated_at };
  }

  @Get('organizations/:orgId/balances/entries')
  async entries(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('userId') userId?: string) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];

    const targetUserId = await this.resolveTargetUserId(db, orgId, callerId, userId);
    if (!targetUserId) return [];

    return this.balances.listEntries(db, orgId, targetUserId);
  }

  /** Admin-only: manual correction or entitlement grant, e.g. an employee's initial vacation allowance. */
  @Post('organizations/:orgId/balances/adjust')
  async adjust(
    @Param('orgId') orgId: string,
    @Body() body: { userId: string; balanceType: BalanceType; deltaMinutes: number; note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    if (!body.userId || !BALANCE_TYPES.includes(body.balanceType)) return { ok: false, error: 'invalid-request' };
    if (typeof body.deltaMinutes !== 'number' || !Number.isFinite(body.deltaMinutes)) return { ok: false, error: 'invalid-delta' };

    await this.balances.adjust(db, orgId, body.userId, body.balanceType, body.deltaMinutes, body.note?.trim() || null);
    return { ok: true };
  }

  /** Self, or an org admin, or that person's manager — same visibility rule as project-time's list. */
  private async resolveTargetUserId(
    db: NonNullable<ReturnType<DbService['getDb']>>,
    orgId: string,
    callerId: string,
    userId: string | undefined,
  ): Promise<string | null> {
    if (!userId || userId === callerId) return callerId;
    const isAdmin = await isOrgAdmin(db, orgId, callerId);
    if (isAdmin || (await isManagerOf(db, orgId, callerId, userId))) return userId;
    return null;
  }
}
