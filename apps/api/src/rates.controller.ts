import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { member_rates, users } from './db/schema';

/**
 * Hourly cost rates — compensation data, so every route here is admin-only
 * (isOrgAdmin), unlike hours data which managers can already see broadly.
 */
@Controller('organizations/:orgId/rates')
export class RatesController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgAdmin(db, orgId, callerId))) return [];
    return db
      .select({
        id: member_rates.id,
        user_id: member_rates.user_id,
        display_name: users.display_name,
        email: users.email,
        hourly_rate: member_rates.hourly_rate,
        currency: member_rates.currency,
        effective_from: member_rates.effective_from,
        effective_to: member_rates.effective_to,
      })
      .from(member_rates)
      .innerJoin(users, eq(users.id, member_rates.user_id))
      .where(eq(member_rates.organization_id, orgId))
      .orderBy(asc(users.display_name), desc(member_rates.effective_from));
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { userId: string; hourlyRate: number; currency?: string; effectiveFrom?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    if (!body.userId) return { ok: false, error: 'user-id-required' };
    if (typeof body.hourlyRate !== 'number' || body.hourlyRate < 0 || Number.isNaN(body.hourlyRate)) {
      return { ok: false, error: 'invalid-hourly-rate' };
    }
    const effectiveFrom = body.effectiveFrom?.trim() || new Date().toISOString().slice(0, 10);

    // Close whatever rate was open for this person, right up to the new one's start.
    await db
      .update(member_rates)
      .set({ effective_to: effectiveFrom })
      .where(
        and(
          eq(member_rates.organization_id, orgId),
          eq(member_rates.user_id, body.userId),
          isNull(member_rates.effective_to),
        ),
      );

    const [created] = await db
      .insert(member_rates)
      .values({
        organization_id: orgId,
        user_id: body.userId,
        hourly_rate: body.hourlyRate.toFixed(2),
        currency: body.currency?.trim().toUpperCase() || 'USD',
        effective_from: effectiveFrom,
      })
      .returning({ id: member_rates.id });
    return { ok: true, id: created.id };
  }
}
