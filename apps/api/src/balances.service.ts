import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { balance_adjustments, organization_memberships, timesheet_periods, users, vacation_entitlements, work_time_months } from './db/schema';
import { WorkTimeModelService, localDate, type WorkTimeSettings } from './work-time-model.service';
import { VersionsService } from './versions.service';
import {
  dayTargets,
  legalOvertimeBetween,
  monthStart,
  monthsBetween,
  nextMonth,
  roundDays,
  summarizeDays,
  vacationEntitlement,
  weekStart,
  type MonthSummary,
  type WorkTimeModel,
} from '@worktime3/shared/worktime';

/** `legal_overtime` is the Überzeit share of the overtime balance; its adjustments move both. */
export const BALANCE_KINDS = ['overtime', 'vacation', 'legal_overtime'] as const;
export type BalanceKind = (typeof BALANCE_KINDS)[number];
export const ADJUSTMENT_KINDS = ['opening', 'correction', 'payout'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export interface ClosedMonth {
  month: string;
  closedAt: string | null;
  summary: MonthSummary;
  /** Überzeit frozen with the month; null/absent for months closed before it was recorded. */
  legalOvertime?: number | null;
}

export interface Adjustment {
  id: string;
  balance: BalanceKind;
  kind: AdjustmentKind;
  effectiveDate: string;
  /** Minutes for overtime, full-time days for vacation. */
  amount: number;
  note: string | null;
}

/**
 * How a month stands: `closed` once its timesheet is approved (numbers frozen); otherwise the
 * timesheet's status (`submitted`, `rejected`) or, without one, `open` (past), `current` or
 * `future`. Months before the person's balances start are `before-start`.
 */
export type MonthStatus = 'closed' | 'submitted' | 'rejected' | 'open' | 'current' | 'future' | 'before-start';

export interface MonthBalance extends MonthSummary {
  month: string;
  status: MonthStatus;
  closedAt: string | null;
  /** Target of the whole month; `target`/`actual`/`delta` cover only the days before today. */
  monthTarget: number;
  /** Approved vacation after today, in full-time days. */
  plannedVacationDays: number;
  /** Overtime adjustments effective in the month. */
  adjustmentMinutes: number;
  /** Overtime balance carried into the month (end of the previous month). */
  overtimeOpening: number;
  /** Overtime balance at the end of the month (everything up to it, adjustments included). */
  overtimeBalance: number;
  /** Vacation days carried into the month (end of the previous month; in January, last year's rest). */
  vacationOpening: number;
  /** The year's entitlement, credited in January or in the person's first month. */
  vacationCredited: number;
  /** Vacation adjustments effective in the month, in days. */
  vacationAdjustmentDays: number;
  /** Vacation days left at the end of the month, after taken and planned vacation. */
  vacationBalance: number;
  /** Überzeit accrued in the month (attendance beyond the legal weekly maximum, days before today). */
  legalOvertimeMinutes: number;
  /** Überzeit adjustments effective in the month (e.g. a payout, negative). */
  legalOvertimeAdjustments: number;
  /** Überzeit balance at the end of the month; the rest of `overtimeBalance` is regular overtime. */
  legalOvertimeBalance: number;
}

export interface YearBalances {
  year: number;
  /** First day balances count for this person. */
  start: string;
  months: MonthBalance[];
  overtime: {
    opening: number;
    closing: number;
    /** All time up to now: closed months plus adjustments. */
    bookedMinutes: number;
    /** All time up to now: days before today in months not closed yet. */
    pendingMinutes: number;
    pendingSince: string | null;
  };
  vacation: {
    carryOver: number;
    entitlement: number;
    entitlementOverridden: boolean;
    adjustments: number;
    taken: number;
    planned: number;
    /** carryOver + entitlement + adjustments − taken − planned. */
    remaining: number;
  };
  /** Überzeit, a share of the overtime balance above. */
  legalOvertime: {
    opening: number;
    closing: number;
    /** Accrued in the year (before adjustments), to compare with the yearly limit. */
    accrued: number;
    adjustments: number;
    yearLimitMinutes: number;
    maxWeeklyMinutes: number;
  };
}

export interface BalanceInputs {
  year: number;
  /** The person's local date today. */
  today: string;
  start: string;
  /** Exclusive end of the membership, when it ends. */
  until: string | null;
  settings: Pick<WorkTimeSettings, 'fullTimeWeeklyMinutes' | 'vacationDaysPerYear' | 'legalMaxWeeklyMinutes' | 'legalOvertimeYearLimitMinutes'>;
  /** Covers [min(start, 1 Jan of year), balanceRangeEnd(year, today)). */
  model: WorkTimeModel;
  /** Attended minutes per day of closed sessions, before today (from the Monday of `start`'s week, for Überzeit). */
  attendance: ReadonlyMap<string, number>;
  closed: readonly ClosedMonth[];
  /** Timesheet status per month start. */
  periodStatus: ReadonlyMap<string, string>;
  adjustments: readonly Adjustment[];
  entitlementOverrides: ReadonlyMap<number, number>;
}

/** Exclusive end of what a year's balances need: the end of that year, or of the current month if later. */
export function balanceRangeEnd(year: number, today: string): string {
  const yearEnd = `${year + 1}-01-01`;
  const currentEnd = nextMonth(monthStart(today));
  return currentEnd > yearEnd ? currentEnd : yearEnd;
}

const EMPTY_SUMMARY: MonthSummary = { scheduled: 0, holiday: 0, absenceByType: {}, target: 0, actual: 0, delta: 0, vacationDays: 0 };

function mergeAbsences(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * A year of balances for one person. Closed months use their frozen numbers; other months are
 * computed from the work-time model: target, attendance and vacation taken for the days before
 * today, planned vacation for the days after. The overtime balance runs from `start` through
 * every month; vacation is entitlement per year minus vacation taken, carried over year to year.
 */
const NO_RUNNING = { overtimeOpening: 0, overtimeBalance: 0, vacationOpening: 0, vacationCredited: 0, vacationAdjustmentDays: 0, vacationBalance: 0, legalOvertimeMinutes: 0, legalOvertimeAdjustments: 0, legalOvertimeBalance: 0 };

export function computeYearBalances(input: BalanceInputs): YearBalances {
  const { year, today, start, model, attendance, settings } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  const rangeStart = monthStart(start < yearStart ? start : yearStart);
  const rangeEnd = balanceRangeEnd(year, today);
  const closedByMonth = new Map(input.closed.map((c) => [c.month, c]));
  const fullTime = settings.fullTimeWeeklyMinutes;

  // Adjustments dated before the first month computed still count, in that first month.
  const adjustmentIn = (balance: BalanceKind, from: string, to: string) =>
    input.adjustments
      .filter((a) => a.balance === balance && (from === rangeStart ? a.effectiveDate < to : a.effectiveDate >= from && a.effectiveDate < to))
      .reduce((s, a) => s + a.amount, 0);
  const legalMax = settings.legalMaxWeeklyMinutes;
  let legalRunning = 0;
  let legalOpening = 0;

  let running = 0;
  let opening = 0;
  let booked = 0;
  let pending = 0;
  let pendingSince: string | null = null;
  const all: MonthBalance[] = [];

  for (const m of monthsBetween(rangeStart, rangeEnd)) {
    const next = nextMonth(m);
    if (m === yearStart) {
      opening = running;
      legalOpening = legalRunning;
    }
    const adjustmentMinutes = adjustmentIn('overtime', m, next);
    const legalAdjustments = adjustmentIn('legal_overtime', m, next);
    let legal = 0;
    const closed = closedByMonth.get(m);
    let row: MonthBalance;
    if (closed) {
      row = { ...closed.summary, month: m, status: 'closed', closedAt: closed.closedAt, monthTarget: closed.summary.target, plannedVacationDays: 0, adjustmentMinutes, ...NO_RUNNING };
      if (m <= today) booked += closed.summary.delta;
      legal = closed.legalOvertime ?? legalOvertimeBetween(attendance, m > start ? m : start, next, legalMax);
    } else if (next <= start) {
      row = { ...EMPTY_SUMMARY, absenceByType: {}, month: m, status: 'before-start', closedAt: null, monthTarget: 0, plannedVacationDays: 0, adjustmentMinutes, ...NO_RUNNING };
    } else {
      const from = m > start ? m : start;
      const pastEnd = next < today ? next : today;
      const futureFrom = from > today ? from : today;
      const past = summarizeDays(from < pastEnd ? dayTargets(from, pastEnd, model) : [], attendance, fullTime);
      const future = summarizeDays(futureFrom < next ? dayTargets(futureFrom, next, model) : [], new Map(), fullTime);
      const timesheet = input.periodStatus.get(m);
      const status: MonthStatus =
        timesheet === 'submitted' || timesheet === 'rejected' ? timesheet : next <= today ? 'open' : m <= today ? 'current' : 'future';
      row = {
        ...past,
        scheduled: past.scheduled + future.scheduled,
        holiday: past.holiday + future.holiday,
        absenceByType: mergeAbsences(past.absenceByType, future.absenceByType),
        month: m,
        status,
        closedAt: null,
        monthTarget: past.target + future.target,
        plannedVacationDays: future.vacationDays,
        adjustmentMinutes,
        ...NO_RUNNING,
      };
      if (from < pastEnd) {
        legal = legalOvertimeBetween(attendance, from, pastEnd, legalMax);
        pending += past.delta;
        pendingSince ??= from;
      }
    }
    booked += adjustmentMinutes + legalAdjustments;
    row.overtimeOpening = running;
    running += row.delta + adjustmentMinutes + legalAdjustments;
    row.overtimeBalance = running;
    legalRunning += legal + legalAdjustments;
    row.legalOvertimeMinutes = legal;
    row.legalOvertimeAdjustments = legalAdjustments;
    row.legalOvertimeBalance = legalRunning;
    all.push(row);
  }
  const months = all.filter((r) => r.month >= yearStart && r.month < yearEnd);
  const closing = months.length ? months[months.length - 1].overtimeBalance : opening;
  const legalOvertime = {
    opening: legalOpening,
    closing: months.length ? months[months.length - 1].legalOvertimeBalance : legalOpening,
    accrued: months.reduce((s, r) => s + r.legalOvertimeMinutes, 0),
    adjustments: months.reduce((s, r) => s + r.legalOvertimeAdjustments, 0),
    yearLimitMinutes: settings.legalOvertimeYearLimitMinutes,
    maxWeeklyMinutes: legalMax,
  };

  // Vacation, per year from the start year up to the one asked for.
  const vacationAdjustments = input.adjustments.filter((a) => a.balance === 'vacation');
  const startYear = Number(start.slice(0, 4));
  let carryOver = 0;
  let current = { entitlement: 0, overridden: false, adjustments: 0, taken: 0, planned: 0 };
  for (let y = Math.min(startYear, year); y <= year; y++) {
    const ys = `${y}-01-01`;
    const ye = `${y + 1}-01-01`;
    const override = input.entitlementOverrides.get(y);
    const entitlement = y < startYear ? 0 : override ?? vacationEntitlement(y, settings.vacationDaysPerYear, model.schedules, model.fallback, start, input.until);
    const adjustments = vacationAdjustments
      .filter((a) => (y === Math.min(startYear, year) ? a.effectiveDate < ye : a.effectiveDate >= ys && a.effectiveDate < ye))
      .reduce((s, a) => s + a.amount, 0);
    const inYear = all.filter((r) => r.month >= ys && r.month < ye);
    const taken = inYear.reduce((s, r) => s + r.vacationDays, 0);
    const planned = inYear.reduce((s, r) => s + r.plannedVacationDays, 0);
    // Month by month: the entitlement is credited in the year's first counted month, adjustments
    // in the month they take effect (earlier ones in the first month computed).
    const creditMonth = monthStart(start > ys ? start : ys);
    let left = carryOver;
    for (const r of inYear) {
      const next = nextMonth(r.month);
      r.vacationOpening = roundDays(left);
      r.vacationCredited = r.month === creditMonth ? roundDays(entitlement) : 0;
      r.vacationAdjustmentDays = roundDays(
        vacationAdjustments
          .filter((a) => (r.month === rangeStart ? a.effectiveDate < next : a.effectiveDate >= r.month && a.effectiveDate < next))
          .reduce((s, a) => s + a.amount, 0),
      );
      left += r.vacationCredited + r.vacationAdjustmentDays - r.vacationDays - r.plannedVacationDays;
      r.vacationBalance = roundDays(left);
    }
    if (y < year) carryOver += entitlement + adjustments - taken - planned;
    else current = { entitlement, overridden: override !== undefined, adjustments, taken, planned };
  }
  carryOver = roundDays(carryOver);

  return {
    year,
    start,
    months,
    overtime: { opening, closing, bookedMinutes: booked, pendingMinutes: pending, pendingSince },
    vacation: {
      carryOver,
      entitlement: roundDays(current.entitlement),
      entitlementOverridden: current.overridden,
      adjustments: roundDays(current.adjustments),
      taken: roundDays(current.taken),
      planned: roundDays(current.planned),
      remaining: roundDays(carryOver + current.entitlement + current.adjustments - current.taken - current.planned),
    },
    legalOvertime,
  };
}

export type ReportAlert =
  | 'overtime-high'
  | 'overtime-low'
  | 'not-submitted'
  | 'awaiting-approval'
  | 'rejected'
  | 'vacation-negative'
  | 'legal-overtime'
  | 'legal-overtime-limit';

/** Alerts for one person's month in the balance report. */
/**
 * Alerts for one person's month in the balance report. `legalYearToDate` is the Überzeit accrued
 * in the year up to the end of that month, checked against the yearly legal limit.
 */
export function reportAlerts(
  month: MonthBalance,
  vacationRemaining: number,
  today: string,
  settings: Pick<WorkTimeSettings, 'overtimeAlertMinutes' | 'undertimeAlertMinutes' | 'legalOvertimeYearLimitMinutes'>,
  legalYearToDate = 0,
): ReportAlert[] {
  const alerts: ReportAlert[] = [];
  if (month.overtimeBalance > settings.overtimeAlertMinutes) alerts.push('overtime-high');
  if (month.overtimeBalance < -settings.undertimeAlertMinutes) alerts.push('overtime-low');
  const ended = nextMonth(month.month) <= today;
  if (month.status === 'submitted') alerts.push('awaiting-approval');
  else if (month.status === 'rejected') alerts.push('rejected');
  else if (ended && month.status === 'open') alerts.push('not-submitted');
  if (vacationRemaining < 0) alerts.push('vacation-negative');
  if (legalYearToDate > settings.legalOvertimeYearLimitMinutes) alerts.push('legal-overtime-limit');
  else if (month.legalOvertimeMinutes > 0) alerts.push('legal-overtime');
  return alerts;
}

/** Turns a `work_time_months` row back into a summary. */
function closedFromRow(r: typeof work_time_months.$inferSelect): ClosedMonth {
  return {
    month: r.month,
    closedAt: r.closed_at,
    summary: {
      scheduled: r.scheduled_minutes,
      holiday: r.holiday_minutes,
      absenceByType: (r.absence_minutes ?? {}) as Record<string, number>,
      target: r.target_minutes,
      actual: r.actual_minutes,
      delta: r.delta_minutes,
      vacationDays: Number(r.vacation_days),
    },
    legalOvertime: r.legal_overtime_minutes,
  };
}

/**
 * Overtime and vacation balances. A month is closed when its working-time timesheet is approved
 * (`work_time_months` freezes its numbers) and reopened when the timesheet is; open months are
 * computed live from the work-time model. Adjustments (opening balance, correction, payout) and
 * per-year vacation entitlements are the only stored inputs besides that. Callers authorize.
 */
@Injectable()
export class BalancesService {
  constructor(
    private readonly workTime: WorkTimeModelService,
    private readonly versions: VersionsService,
  ) {}

  /** Freezes a month from its approved timesheet (replacing an earlier closing of the same month). */
  async closeMonth(db: Db, periodId: string, actorUserId: string | null): Promise<void> {
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, user_id: timesheet_periods.user_id, period_start: timesheet_periods.period_start, period_end: timesheet_periods.period_end })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, periodId));
    if (!period) return;
    const { organization_id: orgId, user_id: userId, period_start: from, period_end: to } = period;
    const [settings, timeZone] = await Promise.all([this.workTime.settings(db, orgId), this.workTime.timeZone(db, userId)]);
    const [targets, attended] = await Promise.all([
      this.workTime.targets(db, orgId, userId, from, to),
      // From the week's Monday: Überzeit counts the whole calendar week.
      this.workTime.attendanceByDay(db, orgId, userId, weekStart(from), to, timeZone, false),
    ]);
    const s = summarizeDays(targets, attended, settings.fullTimeWeeklyMinutes);
    const legal = legalOvertimeBetween(attended, from, to, settings.legalMaxWeeklyMinutes);
    const values = {
      organization_id: orgId,
      user_id: userId,
      month: monthStart(from),
      timesheet_period_id: periodId,
      scheduled_minutes: s.scheduled,
      holiday_minutes: s.holiday,
      absence_minutes: s.absenceByType,
      target_minutes: s.target,
      actual_minutes: s.actual,
      delta_minutes: s.delta,
      vacation_days: String(s.vacationDays),
      legal_overtime_minutes: legal,
      closed_by_user_id: actorUserId,
      closed_at: new Date().toISOString(),
    };
    const [row] = await db
      .insert(work_time_months)
      .values(values)
      .onConflictDoUpdate({ target: [work_time_months.organization_id, work_time_months.user_id, work_time_months.month], set: values })
      .returning({ id: work_time_months.id });
    void this.versions.record('work_time_months', row.id, 'update', actorUserId, values).catch(() => {});
  }

  /** Undoes a closing when its timesheet is reopened: the month is computed live again. */
  async reopenMonth(db: Db, periodId: string, actorUserId: string | null): Promise<void> {
    const removed = await db.delete(work_time_months).where(eq(work_time_months.timesheet_period_id, periodId)).returning({ id: work_time_months.id });
    for (const r of removed) void this.versions.record('work_time_months', r.id, 'delete', actorUserId, { timesheet_period_id: periodId }).catch(() => {});
  }

  /** Closes approved timesheets that have no closed month yet (approved before closings existed, or seeded). */
  private async closeMissing(db: Db, orgId: string, userId: string): Promise<void> {
    const missing = await db.execute(sql`
      SELECT p.id, p.reviewed_by_user_id FROM timesheet_periods p
      WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM work_time_months m WHERE m.organization_id = p.organization_id AND m.user_id = p.user_id AND m.month = p.period_start)`);
    for (const r of missing.rows as { id: string; reviewed_by_user_id: string | null }[]) await this.closeMonth(db, r.id, r.reviewed_by_user_id);
  }

  /**
   * First day balances count: the organization's start date if set, else the person's first
   * recorded activity (attendance, approved absence or closed month), else today; never before
   * they joined.
   */
  async startDate(db: Db, orgId: string, userId: string, settings: WorkTimeSettings, timeZone: string, today: string): Promise<{ start: string; until: string | null }> {
    const [membership] = await db
      .select({ joined_at: organization_memberships.joined_at, exit_at: organization_memberships.exit_at })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    const joined = membership?.joined_at ? localDate(membership.joined_at, timeZone) : null;
    const until = membership?.exit_at ? localDate(membership.exit_at, timeZone) : null;
    let start = settings.balancesStartDate;
    if (!start) {
      const result = await db.execute(sql`
        SELECT to_char(LEAST(
          (SELECT MIN((check_in AT TIME ZONE ${timeZone})::date) FROM work_times WHERE organization_id = ${orgId} AND user_id = ${userId}),
          (SELECT MIN(date_start) FROM absences WHERE organization_id = ${orgId} AND user_id = ${userId} AND status = 'approved'),
          (SELECT MIN(month) FROM work_time_months WHERE organization_id = ${orgId} AND user_id = ${userId})
        ), 'YYYY-MM-DD') AS first_day`);
      start = (result.rows[0] as { first_day: string | null } | undefined)?.first_day ?? today;
    }
    if (joined && joined > start) start = joined;
    return { start, until };
  }

  async adjustments(db: Db, orgId: string, userId: string): Promise<Adjustment[]> {
    const rows = await db
      .select()
      .from(balance_adjustments)
      .where(and(eq(balance_adjustments.organization_id, orgId), eq(balance_adjustments.user_id, userId)))
      .orderBy(asc(balance_adjustments.effective_date));
    return rows.map((r) => ({ id: r.id, balance: r.balance as BalanceKind, kind: r.kind as AdjustmentKind, effectiveDate: r.effective_date, amount: Number(r.amount), note: r.note }));
  }

  async entitlementOverrides(db: Db, orgId: string, userId: string): Promise<Map<number, number>> {
    const rows = await db
      .select({ year: vacation_entitlements.year, days: vacation_entitlements.days })
      .from(vacation_entitlements)
      .where(and(eq(vacation_entitlements.organization_id, orgId), eq(vacation_entitlements.user_id, userId)));
    return new Map(rows.map((r) => [r.year, Number(r.days)]));
  }

  /** One person's balances for a year, with the adjustments behind them. */
  async year(db: Db, orgId: string, userId: string, year: number, now: Date = new Date()): Promise<YearBalances & { adjustments: Adjustment[] }> {
    await this.closeMissing(db, orgId, userId);
    const [settings, timeZone] = await Promise.all([this.workTime.settings(db, orgId), this.workTime.timeZone(db, userId)]);
    const today = localDate(now, timeZone);
    const { start, until } = await this.startDate(db, orgId, userId, settings, timeZone, today);
    const yearStart = `${year}-01-01`;
    const modelFrom = start < yearStart ? start : yearStart;
    const [model, attendance, closedRows, periods, adjustments, overrides] = await Promise.all([
      this.workTime.model(db, orgId, userId, modelFrom, balanceRangeEnd(year, today)),
      start < today ? this.workTime.attendanceByDay(db, orgId, userId, weekStart(start), today, timeZone, false) : Promise.resolve(new Map<string, number>()),
      db.select().from(work_time_months).where(and(eq(work_time_months.organization_id, orgId), eq(work_time_months.user_id, userId))),
      db
        .select({ period_start: timesheet_periods.period_start, status: timesheet_periods.status })
        .from(timesheet_periods)
        .where(and(eq(timesheet_periods.organization_id, orgId), eq(timesheet_periods.user_id, userId))),
      this.adjustments(db, orgId, userId),
      this.entitlementOverrides(db, orgId, userId),
    ]);
    const balances = computeYearBalances({
      year,
      today,
      start,
      until,
      settings,
      model,
      attendance,
      closed: closedRows.map(closedFromRow),
      periodStatus: new Map(periods.map((p) => [monthStart(p.period_start), p.status])),
      adjustments,
      entitlementOverrides: overrides,
    });
    return { ...balances, adjustments: adjustments.filter((a) => a.effectiveDate >= `${year}-01-01` && a.effectiveDate < `${year + 1}-01-01`) };
  }

  /** The balance report for a month: every person the caller may list, with alerts. */
  async report(db: Db, orgId: string, userIds: 'all' | string[], month: string, now: Date = new Date()) {
    const conditions = [eq(organization_memberships.organization_id, orgId), eq(organization_memberships.is_active, true)];
    if (userIds !== 'all') {
      if (userIds.length === 0) return [];
      conditions.push(inArray(organization_memberships.user_id, userIds));
    }
    const people = await db
      .select({ user_id: users.id, display_name: users.display_name, email: users.email })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(...conditions))
      .orderBy(asc(users.display_name));
    const settings = await this.workTime.settings(db, orgId);
    const year = Number(month.slice(0, 4));
    const rows = [];
    for (const p of people) {
      const balances = await this.year(db, orgId, p.user_id, year, now);
      const row = balances.months.find((m) => m.month === month);
      if (!row) continue;
      const today = localDate(now, await this.workTime.timeZone(db, p.user_id));
      const legalYearToDate = balances.months.filter((m) => m.month <= month).reduce((s, m) => s + m.legalOvertimeMinutes, 0);
      rows.push({
        userId: p.user_id,
        displayName: p.display_name,
        email: p.email,
        month: row,
        vacationRemaining: balances.vacation.remaining,
        legalYearToDate,
        legalYearLimit: settings.legalOvertimeYearLimitMinutes,
        alerts: row.status === 'before-start' ? [] : reportAlerts(row, balances.vacation.remaining, today, settings, legalYearToDate),
      });
    }
    return rows;
  }

  async addAdjustment(
    db: Db,
    params: { organizationId: string; userId: string; balance: BalanceKind; kind: AdjustmentKind; effectiveDate: string; amount: number; note: string | null; actorUserId: string },
  ): Promise<string> {
    const values = {
      organization_id: params.organizationId,
      user_id: params.userId,
      balance: params.balance,
      kind: params.kind,
      effective_date: params.effectiveDate,
      amount: String(params.amount),
      note: params.note,
      created_by_user_id: params.actorUserId,
    };
    const [row] = await db.insert(balance_adjustments).values(values).returning({ id: balance_adjustments.id });
    void this.versions.record('balance_adjustments', row.id, 'insert', params.actorUserId, { id: row.id, ...values }).catch(() => {});
    return row.id;
  }

  async findAdjustment(db: Db, id: string) {
    const [row] = await db
      .select({ id: balance_adjustments.id, organization_id: balance_adjustments.organization_id, user_id: balance_adjustments.user_id })
      .from(balance_adjustments)
      .where(eq(balance_adjustments.id, id));
    return row ?? null;
  }

  async deleteAdjustment(db: Db, id: string, actorUserId: string): Promise<void> {
    await db.delete(balance_adjustments).where(eq(balance_adjustments.id, id));
    void this.versions.record('balance_adjustments', id, 'delete', actorUserId, { id }).catch(() => {});
  }

  /** Sets a person's vacation days for a year, or (days = null) goes back to the organization's default. */
  async setEntitlement(db: Db, orgId: string, userId: string, year: number, days: number | null, note: string | null, actorUserId: string): Promise<void> {
    const where = and(eq(vacation_entitlements.organization_id, orgId), eq(vacation_entitlements.user_id, userId), eq(vacation_entitlements.year, year));
    if (days === null) {
      const removed = await db.delete(vacation_entitlements).where(where).returning({ id: vacation_entitlements.id });
      for (const r of removed) void this.versions.record('vacation_entitlements', r.id, 'delete', actorUserId, { year }).catch(() => {});
      return;
    }
    const values = { organization_id: orgId, user_id: userId, year, days: String(days), note };
    const [row] = await db
      .insert(vacation_entitlements)
      .values(values)
      .onConflictDoUpdate({ target: [vacation_entitlements.organization_id, vacation_entitlements.user_id, vacation_entitlements.year], set: { days: values.days, note } })
      .returning({ id: vacation_entitlements.id });
    void this.versions.record('vacation_entitlements', row.id, 'update', actorUserId, values).catch(() => {});
  }
}

