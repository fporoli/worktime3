// Pure helpers for the team overview tables and the absence calendar (tested by teamOverview.test.mjs).

export interface TeamAbsence {
  id: string;
  user_id: string;
  date_start: string;
  date_end: string;
  status: string;
  absence_type: string | null;
  half_day: boolean;
  note: string | null;
}

/** 'YYYY-MM' of a date, or of today. */
export function monthOf(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The month `delta` months from 'YYYY-MM'. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Every 'YYYY-MM-DD' of the month. */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** 0 = Sunday … 6 = Saturday, independent of the browser's time zone. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const day = weekday(date);
  return day === 0 || day === 6;
}

/** The person's absence covering `date` (approved before pending; rejected ones don't count). */
export function absenceOn(absences: TeamAbsence[], userId: string, date: string): TeamAbsence | undefined {
  const covering = absences.filter((a) => a.user_id === userId && a.status !== 'rejected' && a.date_start <= date && a.date_end >= date);
  return covering.find((a) => a.status === 'approved') ?? covering[0];
}

/**
 * Working days an absence takes within the month: weekdays that are not full holidays,
 * half a day each for a half-day absence.
 */
export function absenceDaysInMonth(absence: TeamAbsence, month: string, fullHolidays: Set<string>): number {
  const days = daysOfMonth(month).filter((d) => d >= absence.date_start && d <= absence.date_end && !isWeekend(d) && !fullHolidays.has(d));
  return days.length * (absence.half_day ? 0.5 : 1);
}

/** Sums of amounts per currency, e.g. [['CHF', 120.5], ['EUR', 30]]. */
export function totalsByCurrency(rows: { value: number | string; currency: string | null }[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const currency = r.currency ?? '';
    totals.set(currency, (totals.get(currency) ?? 0) + Number(r.value || 0));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}
