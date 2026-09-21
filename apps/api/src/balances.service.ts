import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { minutesOf } from './time-bucket.util';
import { absences, organizations, organization_memberships, timesheet_periods, work_time_balance_entries, work_time_balances, work_times } from './db/schema';

export type BalanceType = 'overtime' | 'vacation';

const DEFAULT_WEEKLY_TARGET_MINUTES = 2400; // 40h/week, used when a membership hasn't set its own
const DEFAULT_MAX_HOURS_PER_DAY = 8; // used when an org hasn't set settings.maxHoursPerDay

/** Working (Mon–Fri) day count in `[startInclusive, endExclusive)`, both 'YYYY-MM-DD'. */
export function workingDaysBetween(startInclusive: string, endExclusive: string): number {
  const start = new Date(`${startInclusive}T00:00:00Z`);
  const end = new Date(`${endExclusive}T00:00:00Z`);
  let count = 0;
  for (let d = start; d < end; d = new Date(d.getTime() + 86400000)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/** `date` ('YYYY-MM-DD') shifted forward by `days`, as a 'YYYY-MM-DD' string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Working-day overlap between an inclusive absence range (`date_start`..`date_end`) and an
 * exclusive period range (`[periodStart, periodEnd)`) — clips the absence to the period first
 * so a vacation spanning a month boundary only counts the days that actually fall inside it.
 */
export function overlappingWorkingDays(
  absenceStart: string,
  absenceEnd: string,
  periodStart: string,
  periodEndExclusive: string,
): number {
  const absenceEndExclusive = addDays(absenceEnd, 1);
  const clippedStart = absenceStart > periodStart ? absenceStart : periodStart;
  const clippedEnd = absenceEndExclusive < periodEndExclusive ? absenceEndExclusive : periodEndExclusive;
  if (clippedStart >= clippedEnd) return 0;
  return workingDaysBetween(clippedStart, clippedEnd);
}

/** Vacation-balance debit for one absence, in minutes: working days × org day-hours, halved for a half-day request. */
export function vacationDebitMinutes(dateStart: string, dateEnd: string, halfDay: boolean, dayHours: number): number {
  const workingDays = workingDaysBetween(dateStart, addDays(dateEnd, 1));
  return workingDays * dayHours * 60 * (halfDay ? 0.5 : 1);
}

/**
 * Per-employee/organization balance accounting: an append-only ledger
 * (`work_time_balance_entries`) plus a running-total cache
 * (`work_time_balances`) maintained transactionally alongside it. Two named
 * balances today — `overtime` (worked vs. contracted hours, updated when a
 * timesheet period is approved) and `vacation` (entitlement remaining,
 * updated when a vacation request is approved, or by an admin's manual
 * grant/adjustment).
 */
@Injectable()
export class BalancesService {
  /** Contracted daily minutes for this person — `organization_memberships.settings.weeklyTargetMinutes` / 5, defaulting to a 40h week. */
  async dailyTargetMinutes(db: Db, organizationId: string, userId: string): Promise<number> {
    const [row] = await db
      .select({ settings: organization_memberships.settings })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, organizationId), eq(organization_memberships.user_id, userId)));
    const weekly = (row?.settings as { weeklyTargetMinutes?: number } | null)?.weeklyTargetMinutes;
    return (typeof weekly === 'number' && weekly > 0 ? weekly : DEFAULT_WEEKLY_TARGET_MINUTES) / 5;
  }

  /** Org-wide full-day vacation hours — `organizations.settings.maxHoursPerDay`, defaulting to 8h. */
  async orgMaxHoursPerDay(db: Db, organizationId: string): Promise<number> {
    const [row] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, organizationId));
    const hours = (row?.settings as { maxHoursPerDay?: number } | null)?.maxHoursPerDay;
    return typeof hours === 'number' && hours > 0 ? hours : DEFAULT_MAX_HOURS_PER_DAY;
  }

  /** Insert one ledger row and apply its delta to the running-total cache, in one transaction. */
  async applyEntry(
    db: Db,
    params: {
      organizationId: string;
      userId: string;
      balanceType: BalanceType;
      sourceTable: string | null;
      sourceTableUuid: string | null;
      targetMinutes?: number | null;
      actualMinutes?: number | null;
      deltaMinutes: number;
      note?: string | null;
    },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(work_time_balance_entries).values({
        organization_id: params.organizationId,
        user_id: params.userId,
        balance_type: params.balanceType,
        source_table: params.sourceTable,
        source_table_uuid: params.sourceTableUuid,
        target_minutes: params.targetMinutes != null ? String(params.targetMinutes) : null,
        actual_minutes: params.actualMinutes != null ? String(params.actualMinutes) : null,
        delta_minutes: String(params.deltaMinutes),
        note: params.note ?? null,
      });

      // ON CONFLICT ... DO UPDATE only touches the columns named in `set` — the other balance
      // column is simply left as-is, so only the one this entry affects needs naming here.
      const column = params.balanceType === 'overtime' ? work_time_balances.overtime_minutes : work_time_balances.vacation_minutes;
      await tx
        .insert(work_time_balances)
        .values({
          organization_id: params.organizationId,
          user_id: params.userId,
          overtime_minutes: params.balanceType === 'overtime' ? String(params.deltaMinutes) : '0',
          vacation_minutes: params.balanceType === 'vacation' ? String(params.deltaMinutes) : '0',
        })
        .onConflictDoUpdate({
          target: [work_time_balances.organization_id, work_time_balances.user_id],
          set: {
            [params.balanceType === 'overtime' ? 'overtime_minutes' : 'vacation_minutes']: sql`${column} + ${params.deltaMinutes}::numeric`,
            updated_at: sql`now()`,
          },
        });
    });
  }

  /** Called once a timesheet period is approved: credits/debits the overtime balance by actual-vs-target worked minutes. */
  async applyTimesheetApproval(db: Db, periodId: string): Promise<void> {
    const [period] = await db
      .select({
        organization_id: timesheet_periods.organization_id,
        user_id: timesheet_periods.user_id,
        period_start: timesheet_periods.period_start,
        period_end: timesheet_periods.period_end,
      })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, periodId));
    if (!period) return;

    const sessions = await db
      .select({ check_in: work_times.check_in, check_out: work_times.check_out })
      .from(work_times)
      .where(
        and(
          eq(work_times.organization_id, period.organization_id),
          eq(work_times.user_id, period.user_id),
          gte(work_times.check_in, period.period_start),
          lt(work_times.check_in, period.period_end),
          isNotNull(work_times.check_out),
        ),
      );
    const actualMinutes = minutesOf(sessions.map((s) => ({ startTime: s.check_in, endTime: s.check_out as string })));

    const approvedVacations = await db
      .select({ date_start: absences.date_start, date_end: absences.date_end })
      .from(absences)
      .where(
        and(
          eq(absences.organization_id, period.organization_id),
          eq(absences.user_id, period.user_id),
          eq(absences.status, 'approved'),
        ),
      );
    const vacationWorkingDays = approvedVacations.reduce(
      (sum, a) => sum + overlappingWorkingDays(a.date_start, a.date_end, period.period_start, period.period_end),
      0,
    );

    const workingDays = workingDaysBetween(period.period_start, period.period_end);
    const dailyTarget = await this.dailyTargetMinutes(db, period.organization_id, period.user_id);
    const targetMinutes = Math.max(0, workingDays - vacationWorkingDays) * dailyTarget;
    const deltaMinutes = actualMinutes - targetMinutes;

    await this.applyEntry(db, {
      organizationId: period.organization_id,
      userId: period.user_id,
      balanceType: 'overtime',
      sourceTable: 'timesheet_periods',
      sourceTableUuid: periodId,
      targetMinutes,
      actualMinutes,
      deltaMinutes,
    });
  }

  /** Called when an approved period is reopened: posts an offsetting entry rather than mutating history. */
  async reverseTimesheetApproval(db: Db, periodId: string): Promise<void> {
    const [entry] = await db
      .select({
        organization_id: work_time_balance_entries.organization_id,
        user_id: work_time_balance_entries.user_id,
        delta_minutes: work_time_balance_entries.delta_minutes,
      })
      .from(work_time_balance_entries)
      .where(
        and(
          eq(work_time_balance_entries.source_table, 'timesheet_periods'),
          eq(work_time_balance_entries.source_table_uuid, periodId),
          eq(work_time_balance_entries.balance_type, 'overtime'),
        ),
      )
      .orderBy(desc(work_time_balance_entries.created_at))
      .limit(1);
    if (!entry) return;

    await this.applyEntry(db, {
      organizationId: entry.organization_id,
      userId: entry.user_id,
      balanceType: 'overtime',
      sourceTable: 'timesheet_periods',
      sourceTableUuid: periodId,
      deltaMinutes: -Number(entry.delta_minutes),
      note: 'reversed: period reopened',
    });
  }

  /**
   * Called once a vacation request is approved: debits the vacation balance by the working days
   * it covers, at the org's full-day hours (halved for a half-day request). Only `vacation`-type
   * absences touch this balance — sickness/accident/etc. are tracked but don't debit it.
   */
  async applyAbsenceApproval(db: Db, absenceId: string): Promise<void> {
    const [absence] = await db
      .select({
        organization_id: absences.organization_id,
        user_id: absences.user_id,
        date_start: absences.date_start,
        date_end: absences.date_end,
        absence_type: absences.absence_type,
        half_day: absences.half_day,
      })
      .from(absences)
      .where(eq(absences.id, absenceId));
    if (!absence || absence.absence_type !== 'vacation') return;

    const dayHours = await this.orgMaxHoursPerDay(db, absence.organization_id);
    const minutes = vacationDebitMinutes(absence.date_start, absence.date_end, absence.half_day, dayHours);

    await this.applyEntry(db, {
      organizationId: absence.organization_id,
      userId: absence.user_id,
      balanceType: 'vacation',
      sourceTable: 'absences',
      sourceTableUuid: absenceId,
      deltaMinutes: -minutes,
    });
  }

  /** Manual admin correction or entitlement grant — not tied to any approval. */
  async adjust(
    db: Db,
    organizationId: string,
    userId: string,
    balanceType: BalanceType,
    deltaMinutes: number,
    note: string | null,
  ): Promise<void> {
    await this.applyEntry(db, {
      organizationId,
      userId,
      balanceType,
      sourceTable: null,
      sourceTableUuid: null,
      deltaMinutes,
      note,
    });
  }

  async get(db: Db, organizationId: string, userId: string) {
    const [row] = await db
      .select({ overtime_minutes: work_time_balances.overtime_minutes, vacation_minutes: work_time_balances.vacation_minutes, updated_at: work_time_balances.updated_at })
      .from(work_time_balances)
      .where(and(eq(work_time_balances.organization_id, organizationId), eq(work_time_balances.user_id, userId)));
    return row ?? { overtime_minutes: '0', vacation_minutes: '0', updated_at: null };
  }

  async listEntries(db: Db, organizationId: string, userId: string, limit = 50) {
    return db
      .select()
      .from(work_time_balance_entries)
      .where(and(eq(work_time_balance_entries.organization_id, organizationId), eq(work_time_balance_entries.user_id, userId)))
      .orderBy(desc(work_time_balance_entries.created_at))
      .limit(limit);
  }
}
