import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { VersionsService } from './versions.service';
import { WorkTimeModelService, localDate } from './work-time-model.service';
import { org_holidays, organizations, work_schedules } from './db/schema';
import { addDays, isCanton, isIsoDate, validateSchedule } from '@worktime3/shared/worktime';

/** Whether a submitted or approved timesheet of this person ends after `date` (its target is settled). */
export async function hasLockedPeriodFrom(db: Db, orgId: string, userId: string, date: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM timesheet_periods
    WHERE organization_id = ${orgId} AND user_id = ${userId}
      AND status IN ('submitted', 'approved') AND period_end > ${date}::date
    LIMIT 1`);
  return rows.rows.length > 0;
}

/** First and last+1 day of a calendar year. */
function yearRange(year: number): [string, string] {
  return [`${year}-01-01`, `${year + 1}-01-01`];
}

/**
 * The work-time model's REST side: a person's work schedule (section.workTime.schedule), the organization's work-time settings and holiday calendar
 * (Organization settings), and day-by-day targets.
 */
@Controller()
export class WorkSchedulesController {
  constructor(
    private readonly db: DbService,
    private readonly workTime: WorkTimeModelService,
    private readonly versions: VersionsService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // A person's schedule

  @Get('organizations/:orgId/users/:userId/work-schedule')
  async getSchedule(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, schedules: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'section.workTime.schedule', 'see', userId))) return { ok: false, error: 'forbidden', schedules: [] };
    const [settings, schedules] = await Promise.all([this.workTime.settings(db, orgId), this.workTime.schedules(db, orgId, userId)]);
    return {
      ok: true,
      schedules,
      holidayRegion: settings.holidayRegion,
      fullTimeWeeklyMinutes: settings.fullTimeWeeklyMinutes,
      canEdit: await can(db, orgId, callerId, 'section.workTime.schedule', 'edit', userId),
    };
  }

  /** Adds a schedule from a date (or replaces the one starting that day). */
  @Post('organizations/:orgId/users/:userId/work-schedules')
  async saveSchedule(@Param('orgId') orgId: string, @Param('userId') userId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'section.workTime.schedule', 'edit', userId))) return { ok: false, error: 'forbidden' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'unknown-user' };
    const result = validateSchedule(body);
    if (!result.ok) return result;
    const { schedule } = result;
    // Months already submitted or approved keep the target they were settled with.
    if (await hasLockedPeriodFrom(db, orgId, userId, schedule.validFrom)) return { ok: false, error: 'period-locked' };

    const values = {
      organization_id: orgId,
      user_id: userId,
      valid_from: schedule.validFrom,
      workload_percent: String(schedule.workloadPercent),
      day_minutes: schedule.dayMinutes,
    };
    const [row] = await db
      .insert(work_schedules)
      .values(values)
      .onConflictDoUpdate({
        target: [work_schedules.organization_id, work_schedules.user_id, work_schedules.valid_from],
        set: { workload_percent: values.workload_percent, day_minutes: values.day_minutes },
      })
      .returning({ id: work_schedules.id });
    void this.versions.record('work_schedules', row.id, 'update', callerId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Delete('organizations/:orgId/work-schedules/:id')
  async deleteSchedule(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const [row] = await db
      .select({ user_id: work_schedules.user_id, valid_from: work_schedules.valid_from })
      .from(work_schedules)
      .where(and(eq(work_schedules.id, id), eq(work_schedules.organization_id, orgId)));
    if (!row) return { ok: false, error: 'not-found' };
    if (!(await can(db, orgId, callerId, 'section.workTime.schedule', 'edit', row.user_id))) return { ok: false, error: 'forbidden' };
    if (await hasLockedPeriodFrom(db, orgId, row.user_id, row.valid_from)) return { ok: false, error: 'period-locked' };
    await db.delete(work_schedules).where(eq(work_schedules.id, id));
    void this.versions.record('work_schedules', id, 'delete', callerId, row).catch(() => {});
    return { ok: true };
  }

  /**
   * Day by day from `from` to `to` (inclusive, at most a year): target breakdown, holiday and
   * attended minutes. For the caller, or for `userId` when the caller may see their schedule.
   */
  @Get('organizations/:orgId/day-targets')
  async dayTargets(
    @Param('orgId') orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, days: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated', days: [] };
    const target = userId ?? callerId;
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', days: [] };
    if (target !== callerId && !(await can(db, orgId, callerId, 'section.workTime.schedule', 'see', target))) return { ok: false, error: 'forbidden', days: [] };
    if (!isIsoDate(from) || !isIsoDate(to) || to < from || to > addDays(from, 366)) return { ok: false, error: 'invalid-range', days: [] };

    const toExclusive = addDays(to, 1);
    const timeZone = await this.workTime.timeZone(db, target);
    const [targets, holidays, attendance] = await Promise.all([
      this.workTime.targets(db, orgId, target, from, toExclusive),
      this.workTime.holidays(db, orgId, from, toExclusive),
      this.workTime.attendanceByDay(db, orgId, target, from, toExclusive, timeZone, true),
    ]);
    return {
      ok: true,
      today: localDate(new Date(), timeZone),
      days: targets.map((d) => ({ ...d, holidayInfo: holidays.get(d.date) ?? null, attended: attendance.get(d.date) ?? 0 })),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Organization: work-time settings and holiday calendar

  /** Settings and the year's holidays (built-in and the organization's), for any member. */
  @Get('organizations/:orgId/work-time-settings')
  async getOrgSettings(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('year') yearParam?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, holidays: [], rows: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', holidays: [], rows: [] };
    const year = /^\d{4}$/.test(yearParam ?? '') ? Number(yearParam) : new Date().getFullYear();
    const [from, toExclusive] = yearRange(year);
    const [settings, holidays, rows] = await Promise.all([
      this.workTime.settings(db, orgId),
      this.workTime.holidays(db, orgId, from, toExclusive),
      this.workTime.orgHolidayRows(db, orgId, from, toExclusive),
    ]);
    return {
      ok: true,
      year,
      settings,
      holidays: [...holidays.values()].sort((a, b) => a.date.localeCompare(b.date)),
      rows,
      canEdit: await can(db, orgId, callerId, 'nav.orgSettings', 'edit'),
    };
  }

  @Put('organizations/:orgId/work-time-settings')
  async setOrgSettings(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      fullTimeWeeklyMinutes?: number;
      holidayRegion?: string | null;
      projectTimeToleranceMinutes?: number;
      vacationDaysPerYear?: number;
      overtimeAlertMinutes?: number;
      undertimeAlertMinutes?: number;
      balancesStartDate?: string | null;
      legalMaxWeeklyMinutes?: number;
      legalOvertimeYearLimitMinutes?: number | null;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };

    const patch: Record<string, unknown> = {};
    const remove: string[] = [];
    if (body.fullTimeWeeklyMinutes !== undefined) {
      const w = body.fullTimeWeeklyMinutes;
      if (!Number.isInteger(w) || w <= 0 || w > 7 * 24 * 60) return { ok: false, error: 'invalid-full-time' };
      patch.fullTimeWeeklyMinutes = w;
    }
    if (body.projectTimeToleranceMinutes !== undefined) {
      const t = body.projectTimeToleranceMinutes;
      if (!Number.isInteger(t) || t < 0 || t > 24 * 60) return { ok: false, error: 'invalid-tolerance' };
      patch.projectTimeToleranceMinutes = t;
    }
    if (body.vacationDaysPerYear !== undefined) {
      const d = body.vacationDaysPerYear;
      if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 366) return { ok: false, error: 'invalid-vacation-days' };
      patch.vacationDaysPerYear = Math.round(d * 100) / 100;
    }
    for (const key of ['overtimeAlertMinutes', 'undertimeAlertMinutes'] as const) {
      const v = body[key];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > 100000 * 60) return { ok: false, error: 'invalid-alert' };
      patch[key] = v;
    }
    if (body.legalMaxWeeklyMinutes !== undefined) {
      const m = body.legalMaxWeeklyMinutes;
      if (!Number.isInteger(m) || m < 40 * 60 || m > 60 * 60) return { ok: false, error: 'invalid-legal-max' };
      patch.legalMaxWeeklyMinutes = m;
    }
    if (body.legalOvertimeYearLimitMinutes !== undefined) {
      const l = body.legalOvertimeYearLimitMinutes;
      if (l === null) remove.push('legalOvertimeYearLimitMinutes');
      else if (!Number.isInteger(l) || l < 0 || l > 500 * 60) return { ok: false, error: 'invalid-legal-limit' };
      else patch.legalOvertimeYearLimitMinutes = l;
    }
    if (body.balancesStartDate !== undefined) {
      if (body.balancesStartDate === null) remove.push('balancesStartDate');
      else if (isIsoDate(body.balancesStartDate)) patch.balancesStartDate = body.balancesStartDate;
      else return { ok: false, error: 'invalid-start-date' };
    }
    if (body.holidayRegion !== undefined) {
      if (body.holidayRegion === null) remove.push('holidayRegion');
      else if (isCanton(body.holidayRegion)) patch.holidayRegion = body.holidayRegion;
      else return { ok: false, error: 'invalid-region' };
    }
    if (Object.keys(patch).length === 0 && remove.length === 0) return { ok: true };

    let settings = sql`${organizations.settings} || ${JSON.stringify(patch)}::jsonb`;
    for (const key of remove) settings = sql`(${settings}) - ${key}::text`;
    await db.update(organizations).set({ settings }).where(eq(organizations.id, orgId));
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { ...patch, ...Object.fromEntries(remove.map((k) => [k, null])) } }).catch(() => {});
    return { ok: true, settings: await this.workTime.settings(db, orgId) };
  }

  /** Adds or replaces the organization's entry for a date: an extra day off, or a canton holiday it works on. */
  @Post('organizations/:orgId/holidays')
  async saveHoliday(
    @Param('orgId') orgId: string,
    @Body() body: { date?: string; name?: string | null; fraction?: number; observed?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    if (!isIsoDate(body.date)) return { ok: false, error: 'invalid-date' };
    const observed = body.observed !== false;
    const fraction = body.fraction ?? 1;
    if (fraction !== 1 && fraction !== 0.5) return { ok: false, error: 'invalid-fraction' };
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : null;

    const values = { organization_id: orgId, date: body.date, name, fraction: String(fraction), observed };
    const [row] = await db
      .insert(org_holidays)
      .values(values)
      .onConflictDoUpdate({ target: [org_holidays.organization_id, org_holidays.date], set: { name, fraction: values.fraction, observed } })
      .returning({ id: org_holidays.id });
    void this.versions.record('org_holidays', row.id, 'update', callerId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Delete('organizations/:orgId/holidays/:id')
  async deleteHoliday(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const deleted = await db
      .delete(org_holidays)
      .where(and(eq(org_holidays.id, id), eq(org_holidays.organization_id, orgId)))
      .returning({ id: org_holidays.id, date: org_holidays.date });
    if (deleted.length === 0) return { ok: false, error: 'not-found' };
    void this.versions.record('org_holidays', id, 'delete', callerId, deleted[0]).catch(() => {});
    return { ok: true };
  }
}
