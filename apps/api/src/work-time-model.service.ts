import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { absences, org_holidays, organizations, users, work_schedules } from './db/schema';
import {
  DEFAULT_FULL_TIME_WEEKLY_MINUTES,
  DEFAULT_PROJECT_TIME_TOLERANCE_MINUTES,
  DEFAULT_LEGAL_MAX_WEEKLY_MINUTES,
  DEFAULT_VACATION_DAYS_PER_YEAR,
  defaultLegalOvertimeYearLimit,
  isIsoDate,
  addDays,
  dayTargets,
  defaultSchedule,
  holidaysBetween,
  isCanton,
  projectTimeWithinAttendance,
  type AbsenceSpan,
  type Canton,
  type DayTarget,
  type Holiday,
  type OrgHolidayRow,
  type WorkSchedule,
  type WorkTimeModel,
} from '@worktime3/shared/worktime';

export interface WorkTimeSettings {
  /** Minutes of a 100% week, the base for workload percentages and the default schedule. */
  fullTimeWeeklyMinutes: number;
  /** The organization's canton for public holidays; null = only its own holiday rows. */
  holidayRegion: Canton | null;
  /** How far project time on a day may exceed that day's attendance. */
  projectTimeToleranceMinutes: number;
  /** Vacation days of a full-time year (prorated by workload and membership). */
  vacationDaysPerYear: number;
  /** The balance report flags overtime above this many minutes. */
  overtimeAlertMinutes: number;
  /** The balance report flags a deficit beyond this many minutes. */
  undertimeAlertMinutes: number;
  /** Balances count from this date; null = from each person's first recorded activity. */
  balancesStartDate: string | null;
  /** Legal weekly maximum (ArG art. 9): attendance beyond it is Überzeit. 45 h or 50 h. */
  legalMaxWeeklyMinutes: number;
  /** Überzeit allowed per year (ArG art. 12): 170 h at a 45 h maximum, 140 h at 50 h, unless set. */
  legalOvertimeYearLimitMinutes: number;
}

export const DEFAULT_OVERTIME_ALERT_MINUTES = 50 * 60;
export const DEFAULT_UNDERTIME_ALERT_MINUTES = 20 * 60;

/** Reads `organizations.settings` into work-time settings, with defaults. */
export function parseWorkTimeSettings(settings: unknown): WorkTimeSettings {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const weekly = s.fullTimeWeeklyMinutes;
  const tolerance = s.projectTimeToleranceMinutes;
  const nonNegative = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  const legalMax = typeof s.legalMaxWeeklyMinutes === 'number' && s.legalMaxWeeklyMinutes > 0 ? s.legalMaxWeeklyMinutes : DEFAULT_LEGAL_MAX_WEEKLY_MINUTES;
  return {
    fullTimeWeeklyMinutes: typeof weekly === 'number' && weekly > 0 ? weekly : DEFAULT_FULL_TIME_WEEKLY_MINUTES,
    holidayRegion: isCanton(s.holidayRegion) ? s.holidayRegion : null,
    projectTimeToleranceMinutes: typeof tolerance === 'number' && tolerance >= 0 ? tolerance : DEFAULT_PROJECT_TIME_TOLERANCE_MINUTES,
    vacationDaysPerYear: nonNegative(s.vacationDaysPerYear, DEFAULT_VACATION_DAYS_PER_YEAR),
    overtimeAlertMinutes: nonNegative(s.overtimeAlertMinutes, DEFAULT_OVERTIME_ALERT_MINUTES),
    undertimeAlertMinutes: nonNegative(s.undertimeAlertMinutes, DEFAULT_UNDERTIME_ALERT_MINUTES),
    balancesStartDate: isIsoDate(s.balancesStartDate) ? s.balancesStartDate : null,
    legalMaxWeeklyMinutes: legalMax,
    legalOvertimeYearLimitMinutes: nonNegative(s.legalOvertimeYearLimitMinutes, defaultLegalOvertimeYearLimit(legalMax)),
  };
}

/** 'YYYY-MM-DD' of an instant in a time zone (falls back to UTC for an unknown zone). */
export function localDate(instant: Date | string, timeZone: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type ProjectTimeCheck =
  | { ok: true }
  | { ok: false; error: 'project-exceeds-attendance'; date: string; projectMinutes: number; attendanceMinutes: number; toleranceMinutes: number };

/**
 * Database side of the work-time model (packages/shared/src/worktime.ts): loads a person's
 * schedules, holidays and approved absences, their attendance per local day, and derives
 * targets, the running overtime balance and the project-time check from them. Callers
 * authorize first; nothing here checks permissions.
 */
@Injectable()
export class WorkTimeModelService {
  async settings(db: Db, orgId: string): Promise<WorkTimeSettings> {
    const [row] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
    return parseWorkTimeSettings(row?.settings);
  }

  async timeZone(db: Db, userId: string): Promise<string> {
    const [row] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
    return row?.timezone || 'UTC';
  }

  async schedules(db: Db, orgId: string, userId: string): Promise<(WorkSchedule & { id: string })[]> {
    const rows = await db
      .select({ id: work_schedules.id, valid_from: work_schedules.valid_from, workload_percent: work_schedules.workload_percent, day_minutes: work_schedules.day_minutes })
      .from(work_schedules)
      .where(and(eq(work_schedules.organization_id, orgId), eq(work_schedules.user_id, userId)))
      .orderBy(work_schedules.valid_from);
    return rows.map((r) => ({ id: r.id, validFrom: r.valid_from, workloadPercent: Number(r.workload_percent), dayMinutes: r.day_minutes }));
  }

  async orgHolidayRows(db: Db, orgId: string, from?: string, toExclusive?: string): Promise<(OrgHolidayRow & { id: string })[]> {
    const conditions = [eq(org_holidays.organization_id, orgId)];
    if (from) conditions.push(gte(org_holidays.date, from));
    if (toExclusive) conditions.push(lte(org_holidays.date, addDays(toExclusive, -1)));
    const rows = await db
      .select({ id: org_holidays.id, date: org_holidays.date, name: org_holidays.name, fraction: org_holidays.fraction, observed: org_holidays.observed })
      .from(org_holidays)
      .where(and(...conditions))
      .orderBy(org_holidays.date);
    return rows.map((r) => ({ id: r.id, date: r.date, name: r.name, fraction: Number(r.fraction), observed: r.observed }));
  }

  /** The organization's holidays: its canton's, with its own rows applied. */
  async holidays(db: Db, orgId: string, from: string, toExclusive: string): Promise<Map<string, Holiday>> {
    const settings = await this.settings(db, orgId);
    return holidaysBetween(from, toExclusive, settings.holidayRegion, await this.orgHolidayRows(db, orgId, from, toExclusive));
  }

  /** Approved absences of any type overlapping the range: they all count against the target. */
  async approvedAbsences(db: Db, orgId: string, userId: string, from: string, toExclusive: string): Promise<AbsenceSpan[]> {
    const rows = await db
      .select({ date_start: absences.date_start, date_end: absences.date_end, half_day: absences.half_day, absence_type: absences.absence_type })
      .from(absences)
      .where(
        and(
          eq(absences.organization_id, orgId),
          eq(absences.user_id, userId),
          eq(absences.status, 'approved'),
          lte(absences.date_start, addDays(toExclusive, -1)),
          gte(absences.date_end, from),
        ),
      );
    return rows.map((r) => ({ dateStart: r.date_start, dateEnd: r.date_end, halfDay: r.half_day, type: r.absence_type }));
  }

  async model(db: Db, orgId: string, userId: string, from: string, toExclusive: string): Promise<WorkTimeModel> {
    const settings = await this.settings(db, orgId);
    const [schedules, holidays, spans] = await Promise.all([
      this.schedules(db, orgId, userId),
      this.holidays(db, orgId, from, toExclusive),
      this.approvedAbsences(db, orgId, userId, from, toExclusive),
    ]);
    return { schedules, fallback: defaultSchedule(settings.fullTimeWeeklyMinutes), holidays, absences: spans };
  }

  async targets(db: Db, orgId: string, userId: string, from: string, toExclusive: string): Promise<DayTarget[]> {
    return dayTargets(from, toExclusive, await this.model(db, orgId, userId, from, toExclusive));
  }

  /**
   * Attended minutes per local day ('YYYY-MM-DD' in `timeZone`) from check-in/check-out
   * sessions, by the day of check-in. `includeOpen` counts a session still open up to now.
   */
  async attendanceByDay(db: Db, orgId: string, userId: string, from: string, toExclusive: string, timeZone: string, includeOpen: boolean): Promise<Map<string, number>> {
    const result = await db.execute(sql`
      SELECT to_char((check_in AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day,
             SUM(EXTRACT(EPOCH FROM (COALESCE(check_out, now()) - check_in))) / 60 AS minutes
      FROM work_times
      WHERE organization_id = ${orgId} AND user_id = ${userId}
        AND check_in >= (${from}::date::timestamp AT TIME ZONE ${timeZone})
        AND check_in < (${toExclusive}::date::timestamp AT TIME ZONE ${timeZone})
        ${includeOpen ? sql`` : sql`AND check_out IS NOT NULL`}
      GROUP BY 1`);
    return new Map((result.rows as { day: string; minutes: string | number }[]).map((r) => [r.day, Math.round(Number(r.minutes))]));
  }

  /** Project minutes booked on one local day, by start time, optionally leaving one entry out. */
  async projectMinutesOn(db: Db, orgId: string, userId: string, date: string, timeZone: string, excludeId?: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))), 0) / 60 AS minutes
      FROM project_times
      WHERE organization_id = ${orgId} AND user_id = ${userId}
        AND start_time >= (${date}::date::timestamp AT TIME ZONE ${timeZone})
        AND start_time < (${addDays(date, 1)}::date::timestamp AT TIME ZONE ${timeZone})
        ${excludeId ? sql`AND id <> ${excludeId}` : sql``}`);
    return Math.round(Number((result.rows[0] as { minutes: string | number } | undefined)?.minutes ?? 0));
  }

  /**
   * Whether an entry from `startTime` to `endTime` keeps that day's project time within the
   * day's attendance (an open session counts up to now) plus the organization's tolerance.
   */
  async checkProjectTime(db: Db, orgId: string, userId: string, startTime: string, endTime: string, excludeId?: string): Promise<ProjectTimeCheck> {
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: true };
    const timeZone = await this.timeZone(db, userId);
    const date = localDate(start, timeZone);
    const { projectTimeToleranceMinutes } = await this.settings(db, orgId);
    const entryMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    const projectMinutes = (await this.projectMinutesOn(db, orgId, userId, date, timeZone, excludeId)) + entryMinutes;
    const attendanceMinutes = (await this.attendanceByDay(db, orgId, userId, date, addDays(date, 1), timeZone, true)).get(date) ?? 0;
    if (projectTimeWithinAttendance(projectMinutes, attendanceMinutes, projectTimeToleranceMinutes)) return { ok: true };
    return { ok: false, error: 'project-exceeds-attendance', date, projectMinutes, attendanceMinutes, toleranceMinutes: projectTimeToleranceMinutes };
  }
}
