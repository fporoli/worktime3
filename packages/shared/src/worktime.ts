// Work-time model: each person's work schedule (target minutes per weekday, with history),
// public holidays (Swiss cantons plus organization changes) and the daily target derived from
// them. The API (balances, reports, project-time check) and the web app use the same functions.
//
// Dates are 'YYYY-MM-DD' strings in the organization's local calendar; weekdays are indexed
// Monday = 0 … Sunday = 6. Keep this file erasable TypeScript (no enums, no imports).

export const DEFAULT_FULL_TIME_WEEKLY_MINUTES = 2400; // 40h, when an organization sets none
export const DEFAULT_PROJECT_TIME_TOLERANCE_MINUTES = 15;
export const MAX_DAY_MINUTES = 24 * 60;

// ---------------------------------------------------------------------------------------------
// Dates

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(date: string): number {
  return (utc(date).getUTCDay() + 6) % 7;
}

/** Every date in `[from, toExclusive)`. */
export function datesBetween(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Work schedules

export interface WorkSchedule {
  /** First day this schedule applies; it lasts until the next schedule's `validFrom`. */
  validFrom: string;
  /** Workload in percent of the organization's full-time week (informational). */
  workloadPercent: number;
  /** Target minutes per weekday, Monday … Sunday. */
  dayMinutes: number[];
}

/** Monday–Friday at an equal share of `weeklyMinutes`: the schedule of someone without one. */
export function defaultSchedule(fullTimeWeeklyMinutes: number = DEFAULT_FULL_TIME_WEEKLY_MINUTES): WorkSchedule {
  return { validFrom: '0001-01-01', workloadPercent: 100, dayMinutes: dayMinutesFor(fullTimeWeeklyMinutes, 100, [true, true, true, true, true, false, false]) };
}

/**
 * Target minutes per weekday for a workload: `percent` of the full-time week, spread evenly
 * over the working days (whole minutes; the remainder goes to the first working days).
 */
export function dayMinutesFor(fullTimeWeeklyMinutes: number, percent: number, workingDays: boolean[]): number[] {
  const total = Math.round((fullTimeWeeklyMinutes * percent) / 100);
  const count = workingDays.filter(Boolean).length;
  if (count === 0) return [0, 0, 0, 0, 0, 0, 0];
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  return workingDays.slice(0, 7).map((on) => {
    if (!on) return 0;
    if (remainder > 0) {
      remainder--;
      return base + 1;
    }
    return base;
  });
}

/** The schedule in force on `date`: the latest one starting on or before it, else `fallback`. */
export function scheduleOn(date: string, schedules: readonly WorkSchedule[], fallback: WorkSchedule): WorkSchedule {
  let best: WorkSchedule | null = null;
  for (const s of schedules) if (s.validFrom <= date && (!best || s.validFrom > best.validFrom)) best = s;
  return best ?? fallback;
}

export type ScheduleResult = { ok: true; schedule: WorkSchedule } | { ok: false; error: 'invalid-date' | 'invalid-workload' | 'invalid-day-minutes' };

export function validateSchedule(input: unknown): ScheduleResult {
  const r = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (!isIsoDate(r.validFrom)) return { ok: false, error: 'invalid-date' };
  const percent = r.workloadPercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return { ok: false, error: 'invalid-workload' };
  const days = r.dayMinutes;
  if (!Array.isArray(days) || days.length !== 7 || !days.every((m) => Number.isInteger(m) && m >= 0 && m <= MAX_DAY_MINUTES)) {
    return { ok: false, error: 'invalid-day-minutes' };
  }
  return { ok: true, schedule: { validFrom: r.validFrom, workloadPercent: Math.round(percent * 100) / 100, dayMinutes: days as number[] } };
}

export function weeklyMinutes(schedule: WorkSchedule): number {
  return schedule.dayMinutes.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------------------------
// Public holidays (Switzerland)

export const CANTONS = [
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
  'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH',
] as const;
export type Canton = (typeof CANTONS)[number];

export function isCanton(value: unknown): value is Canton {
  return typeof value === 'string' && (CANTONS as readonly string[]).includes(value);
}

/** Easter Sunday (Gregorian), by the anonymous Gregorian algorithm. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fixed(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The `n`th (1-based) given weekday (Monday = 0) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = fixed(year, month, 1);
  const offset = (weekday - weekdayIndex(first) + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

type HolidayRule = { key: string; date: (year: number) => string; cantons: readonly Canton[] | 'all'; except?: readonly Canton[] };

const ALL: 'all' = 'all';

/**
 * Cantonal public holidays (full days). Compiled from the cantons' published lists; where a
 * holiday applies only in some municipalities of a canton it is left out. Organizations correct
 * or extend it with their own holiday rows, so this is a starting point, not legal advice.
 */
const HOLIDAY_RULES: readonly HolidayRule[] = [
  { key: 'newYear', date: (y) => fixed(y, 1, 1), cantons: ALL },
  { key: 'berchtold', date: (y) => fixed(y, 1, 2), cantons: ['AG', 'BE', 'FR', 'GL', 'JU', 'LU', 'NE', 'OW', 'SH', 'SO', 'TG', 'VD', 'ZG', 'ZH'] },
  { key: 'epiphany', date: (y) => fixed(y, 1, 6), cantons: ['SZ', 'TI', 'UR'] },
  { key: 'neRepublic', date: (y) => fixed(y, 3, 1), cantons: ['NE'] },
  { key: 'stJoseph', date: (y) => fixed(y, 3, 19), cantons: ['NW', 'SZ', 'TI', 'UR', 'VS'] },
  { key: 'goodFriday', date: (y) => addDays(easterSunday(y), -2), cantons: ALL, except: ['TI', 'VS'] },
  { key: 'easterMonday', date: (y) => addDays(easterSunday(y), 1), cantons: ALL, except: ['VS'] },
  {
    key: 'naefelserFahrt',
    // First Thursday of April, a week later when that is Maundy Thursday.
    date: (y) => {
      const d = nthWeekday(y, 4, 3, 1);
      return d === addDays(easterSunday(y), -3) ? addDays(d, 7) : d;
    },
    cantons: ['GL'],
  },
  { key: 'labourDay', date: (y) => fixed(y, 5, 1), cantons: ['BL', 'BS', 'JU', 'NE', 'SH', 'TG', 'TI', 'ZH'] },
  { key: 'ascension', date: (y) => addDays(easterSunday(y), 39), cantons: ALL },
  { key: 'whitMonday', date: (y) => addDays(easterSunday(y), 50), cantons: ALL, except: ['VS'] },
  { key: 'corpusChristi', date: (y) => addDays(easterSunday(y), 60), cantons: ['AG', 'AI', 'FR', 'JU', 'LU', 'NW', 'OW', 'SO', 'SZ', 'TI', 'UR', 'VS', 'ZG'] },
  { key: 'juIndependence', date: (y) => fixed(y, 6, 23), cantons: ['JU'] },
  { key: 'peterPaul', date: (y) => fixed(y, 6, 29), cantons: ['TI'] },
  { key: 'nationalDay', date: (y) => fixed(y, 8, 1), cantons: ALL },
  { key: 'assumption', date: (y) => fixed(y, 8, 15), cantons: ['AG', 'AI', 'FR', 'JU', 'LU', 'NW', 'OW', 'SO', 'SZ', 'TI', 'UR', 'VS', 'ZG'] },
  // Thursday after the first Sunday of September.
  { key: 'genevaFast', date: (y) => addDays(nthWeekday(y, 9, 6, 1), 4), cantons: ['GE'] },
  // Monday after the third Sunday of September.
  { key: 'federalFastMonday', date: (y) => addDays(nthWeekday(y, 9, 6, 3), 1), cantons: ['VD'] },
  { key: 'bruderKlaus', date: (y) => fixed(y, 9, 25), cantons: ['OW'] },
  { key: 'allSaints', date: (y) => fixed(y, 11, 1), cantons: ['AG', 'AI', 'FR', 'GL', 'JU', 'LU', 'NW', 'OW', 'SG', 'SO', 'SZ', 'TI', 'UR', 'VS', 'ZG'] },
  { key: 'immaculateConception', date: (y) => fixed(y, 12, 8), cantons: ['AI', 'FR', 'LU', 'NW', 'OW', 'SZ', 'TI', 'UR', 'VS', 'ZG'] },
  { key: 'christmas', date: (y) => fixed(y, 12, 25), cantons: ALL },
  { key: 'stStephen', date: (y) => fixed(y, 12, 26), cantons: ALL, except: ['GE', 'JU', 'NE', 'VD', 'VS'] },
  { key: 'genevaRestoration', date: (y) => fixed(y, 12, 31), cantons: ['GE'] },
];

export const HOLIDAY_KEYS: readonly string[] = HOLIDAY_RULES.map((r) => r.key);

/** Holiday names in the app's languages. */
export const HOLIDAY_NAMES: Record<string, { en: string; de: string; fr: string; it: string }> = {
  newYear: { en: "New Year's Day", de: 'Neujahr', fr: 'Nouvel An', it: 'Capodanno' },
  berchtold: { en: "St Berchtold's Day", de: 'Berchtoldstag', fr: 'Saint-Berchtold', it: 'San Bertoldo' },
  epiphany: { en: 'Epiphany', de: 'Heilige Drei Könige', fr: 'Épiphanie', it: 'Epifania' },
  neRepublic: { en: 'Republic Day (Neuchâtel)', de: 'Jahrestag der Republik Neuenburg', fr: 'Instauration de la République', it: 'Anniversario della Repubblica (Neuchâtel)' },
  stJoseph: { en: "St Joseph's Day", de: 'Josefstag', fr: 'Saint-Joseph', it: 'San Giuseppe' },
  goodFriday: { en: 'Good Friday', de: 'Karfreitag', fr: 'Vendredi saint', it: 'Venerdì santo' },
  easterMonday: { en: 'Easter Monday', de: 'Ostermontag', fr: 'Lundi de Pâques', it: 'Lunedì di Pasqua' },
  naefelserFahrt: { en: 'Näfels Pilgrimage', de: 'Näfelser Fahrt', fr: 'Fahrt de Näfels', it: 'Pellegrinaggio di Näfels' },
  labourDay: { en: 'Labour Day', de: 'Tag der Arbeit', fr: 'Fête du travail', it: 'Festa del lavoro' },
  ascension: { en: 'Ascension Day', de: 'Auffahrt', fr: 'Ascension', it: 'Ascensione' },
  whitMonday: { en: 'Whit Monday', de: 'Pfingstmontag', fr: 'Lundi de Pentecôte', it: 'Lunedì di Pentecoste' },
  corpusChristi: { en: 'Corpus Christi', de: 'Fronleichnam', fr: 'Fête-Dieu', it: 'Corpus Domini' },
  juIndependence: { en: 'Jura Independence Day', de: 'Jurassischer Unabhängigkeitstag', fr: "Commémoration du plébiscite jurassien", it: "Indipendenza del Giura" },
  peterPaul: { en: 'Saints Peter and Paul', de: 'Peter und Paul', fr: 'Saints Pierre et Paul', it: 'Santi Pietro e Paolo' },
  nationalDay: { en: 'Swiss National Day', de: 'Bundesfeier', fr: 'Fête nationale', it: 'Festa nazionale' },
  assumption: { en: 'Assumption Day', de: 'Mariä Himmelfahrt', fr: 'Assomption', it: 'Assunzione' },
  genevaFast: { en: 'Geneva Fast', de: 'Genfer Bettag', fr: 'Jeûne genevois', it: 'Digiuno ginevrino' },
  federalFastMonday: { en: 'Federal Fast Monday', de: 'Bettagsmontag', fr: 'Lundi du Jeûne fédéral', it: 'Lunedì del Digiuno federale' },
  bruderKlaus: { en: 'St Nicholas of Flüe', de: 'Bruder-Klausen-Fest', fr: 'Saint Nicolas de Flüe', it: 'San Nicolao della Flüe' },
  allSaints: { en: "All Saints' Day", de: 'Allerheiligen', fr: 'Toussaint', it: 'Ognissanti' },
  immaculateConception: { en: 'Immaculate Conception', de: 'Mariä Empfängnis', fr: 'Immaculée Conception', it: 'Immacolata Concezione' },
  christmas: { en: 'Christmas Day', de: 'Weihnachten', fr: 'Noël', it: 'Natale' },
  stStephen: { en: "St Stephen's Day", de: 'Stephanstag', fr: 'Saint-Étienne', it: 'Santo Stefano' },
  genevaRestoration: { en: 'Restoration of the Republic (Geneva)', de: 'Restauration der Republik Genf', fr: 'Restauration de la République', it: 'Restaurazione della Repubblica (Ginevra)' },
};

export interface Holiday {
  date: string;
  /** A built-in holiday's key (name from `HOLIDAY_NAMES`); absent for an organization's own day. */
  key?: string;
  /** An organization's own name for the day (custom days, or a renamed built-in one). */
  name?: string;
  /** Share of the day off: 1 = full day, 0.5 = half day. */
  fraction: number;
  source: 'canton' | 'organization';
}

/** The canton's built-in public holidays in a year, by date. */
export function cantonHolidays(year: number, canton: Canton): Holiday[] {
  const out: Holiday[] = [];
  for (const rule of HOLIDAY_RULES) {
    const applies = rule.cantons === 'all' ? !(rule.except ?? []).includes(canton) : rule.cantons.includes(canton);
    if (applies) out.push({ date: rule.date(year), key: rule.key, fraction: 1, source: 'canton' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** An organization's change to its calendar: an extra day off, or a built-in one it doesn't observe. */
export interface OrgHolidayRow {
  date: string;
  name: string | null;
  fraction: number;
  /** false = this date is a working day even if the canton has a holiday on it. */
  observed: boolean;
}

/**
 * Holidays in `[from, toExclusive)`: the canton's (if any) with the organization's rows applied
 * on top. An observed row replaces the canton's day on that date; a non-observed row removes it.
 */
export function holidaysBetween(from: string, toExclusive: string, canton: Canton | null, orgRows: readonly OrgHolidayRow[]): Map<string, Holiday> {
  const byDate = new Map<string, Holiday>();
  if (canton) {
    const lastYear = Number(addDays(toExclusive, -1).slice(0, 4));
    for (let y = Number(from.slice(0, 4)); y <= lastYear; y++) {
      for (const h of cantonHolidays(y, canton)) if (h.date >= from && h.date < toExclusive) byDate.set(h.date, h);
    }
  }
  for (const row of orgRows) {
    if (row.date < from || row.date >= toExclusive) continue;
    if (!row.observed) {
      byDate.delete(row.date);
      continue;
    }
    const builtIn = byDate.get(row.date);
    byDate.set(row.date, {
      date: row.date,
      ...(builtIn?.key && !row.name ? { key: builtIn.key } : {}),
      ...(row.name ? { name: row.name } : {}),
      fraction: row.fraction,
      source: 'organization',
    });
  }
  return byDate;
}

export function holidayName(h: Pick<Holiday, 'key' | 'name'>, locale: string): string {
  if (h.name) return h.name;
  const names = h.key ? HOLIDAY_NAMES[h.key] : undefined;
  if (!names) return h.key ?? '';
  return (names as Record<string, string>)[locale] ?? names.en;
}

// ---------------------------------------------------------------------------------------------
// Daily target

/** An approved absence (any type) covering `dateStart`..`dateEnd` inclusive. */
export interface AbsenceSpan {
  dateStart: string;
  dateEnd: string;
  halfDay: boolean;
  /** Absence type key (`vacation`, `sick`, …); only `vacation` days count against vacation. */
  type?: string;
}

export interface DayTarget {
  date: string;
  /** Minutes the schedule asks for on this weekday. */
  scheduled: number;
  /** Minutes off for a public holiday. */
  holiday: number;
  /** Minutes credited for an approved absence (after the holiday). */
  absence: number;
  /** Type of the absence behind `absence`, when there is one. */
  absenceType?: string;
  /** Minutes the person is expected to work: scheduled − holiday − absence. */
  target: number;
}

/**
 * The target for one day. A holiday takes its share of the scheduled minutes; an approved
 * absence covers the rest (half of the scheduled minutes for a half-day absence).
 */
export function dayTarget(date: string, schedule: WorkSchedule, holiday: Pick<Holiday, 'fraction'> | undefined, absences: readonly AbsenceSpan[]): DayTarget {
  const scheduled = schedule.dayMinutes[weekdayIndex(date)] ?? 0;
  const holidayMinutes = Math.round(scheduled * Math.min(1, Math.max(0, holiday?.fraction ?? 0)));
  const remaining = scheduled - holidayMinutes;
  let absence = 0;
  let absenceType: string | undefined;
  for (const a of absences) {
    if (a.dateStart <= date && date <= a.dateEnd) {
      const minutes = a.halfDay ? Math.min(remaining, Math.round(scheduled / 2)) : remaining;
      if (minutes > absence) {
        absence = minutes;
        absenceType = a.type;
      }
    }
  }
  const day: DayTarget = { date, scheduled, holiday: holidayMinutes, absence, target: remaining - absence };
  if (absenceType !== undefined && absence > 0) day.absenceType = absenceType;
  return day;
}

export interface WorkTimeModel {
  schedules: readonly WorkSchedule[];
  fallback: WorkSchedule;
  holidays: ReadonlyMap<string, Holiday>;
  absences: readonly AbsenceSpan[];
}

/** Day targets for `[from, toExclusive)`. */
export function dayTargets(from: string, toExclusive: string, model: WorkTimeModel): DayTarget[] {
  return datesBetween(from, toExclusive).map((d) => dayTarget(d, scheduleOn(d, model.schedules, model.fallback), model.holidays.get(d), model.absences));
}

export function sumTargets(days: readonly DayTarget[]): number {
  return days.reduce((sum, d) => sum + d.target, 0);
}

/**
 * Whether booking `projectMinutes` of project time on a day is within the person's attendance
 * that day, give or take the organization's tolerance.
 */
export function projectTimeWithinAttendance(projectMinutes: number, attendanceMinutes: number, toleranceMinutes: number): boolean {
  return projectMinutes <= attendanceMinutes + Math.max(0, toleranceMinutes);
}

// ---------------------------------------------------------------------------------------------
// Balances: monthly summaries, vacation in days

export const DEFAULT_VACATION_DAYS_PER_YEAR = 25;
export const VACATION_ABSENCE_TYPE = 'vacation';

/** 'YYYY-MM-01' of the month containing `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** 'YYYY-MM-01' of the month after `month` (any day of it). */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** First day of each month in `[from, toExclusive)`, starting with `from`'s month. */
export function monthsBetween(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  for (let m = monthStart(from); m < toExclusive; m = nextMonth(m)) out.push(m);
  return out;
}

/**
 * Minutes of one vacation day: a fifth of the full-time week. Vacation is counted in full-time
 * days, so a part-timer's entitlement shrinks with their workload and a day off counts what that
 * day was scheduled for (a half-day schedule takes half a vacation day).
 */
export function fullTimeDayMinutes(fullTimeWeeklyMinutes: number): number {
  return fullTimeWeeklyMinutes > 0 ? fullTimeWeeklyMinutes / 5 : DEFAULT_FULL_TIME_WEEKLY_MINUTES / 5;
}

/** Rounds to two decimals, for day amounts. */
export function roundDays(days: number): number {
  return Math.round(days * 100) / 100;
}

export interface MonthSummary {
  /** Minutes the schedule asks for, before holidays and absences. */
  scheduled: number;
  holiday: number;
  /** Minutes credited per absence type. */
  absenceByType: Record<string, number>;
  target: number;
  actual: number;
  /** actual − target. */
  delta: number;
  /** Vacation taken, in full-time days. */
  vacationDays: number;
}

/** Totals for a run of days, with attendance per day; vacation converted to full-time days. */
export function summarizeDays(days: readonly DayTarget[], attendance: ReadonlyMap<string, number>, fullTimeWeeklyMinutes: number): MonthSummary {
  const summary: MonthSummary = { scheduled: 0, holiday: 0, absenceByType: {}, target: 0, actual: 0, delta: 0, vacationDays: 0 };
  let vacationMinutes = 0;
  for (const d of days) {
    summary.scheduled += d.scheduled;
    summary.holiday += d.holiday;
    summary.target += d.target;
    summary.actual += attendance.get(d.date) ?? 0;
    if (d.absence > 0) {
      const type = d.absenceType ?? 'other';
      summary.absenceByType[type] = (summary.absenceByType[type] ?? 0) + d.absence;
      if (type === VACATION_ABSENCE_TYPE) vacationMinutes += d.absence;
    }
  }
  summary.delta = summary.actual - summary.target;
  summary.vacationDays = roundDays(vacationMinutes / fullTimeDayMinutes(fullTimeWeeklyMinutes));
  return summary;
}

/**
 * Vacation entitlement for a year in full-time days: `daysPerYear` for each day of the year the
 * person counts (from `countFrom`, before `countUntil`), weighted by the workload of the schedule
 * in force that day. A full year at 100% gives `daysPerYear`; joining on 1 July at 50% gives a quarter.
 */
export function vacationEntitlement(
  year: number,
  daysPerYear: number,
  schedules: readonly WorkSchedule[],
  fallback: WorkSchedule,
  countFrom?: string | null,
  countUntil?: string | null,
): number {
  const first = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const from = countFrom && countFrom > first ? countFrom : first;
  const until = countUntil && countUntil < end ? countUntil : end;
  if (from >= until) return 0;
  const daysInYear = datesBetween(first, end).length;
  let weighted = 0;
  for (const d of datesBetween(from, until)) weighted += scheduleOn(d, schedules, fallback).workloadPercent / 100;
  return roundDays((daysPerYear * weighted) / daysInYear);
}

// ---------------------------------------------------------------------------------------------
// Überzeit (legal overtime, Swiss ArG art. 9, 12, 13): attendance beyond the legal weekly
// maximum, 45 h for office, technical and large-retail staff, 50 h for everyone else. At most
// 170 h (45 h week) or 140 h (50 h week) a year. Counted on actual attendance per calendar week
// (Monday to Sunday); a day's share is what it adds beyond the maximum.

export const DEFAULT_LEGAL_MAX_WEEKLY_MINUTES = 45 * 60;

/** The yearly limit the law sets for a weekly maximum: 170 h at 45 h, 140 h at 50 h. */
export function defaultLegalOvertimeYearLimit(legalMaxWeeklyMinutes: number): number {
  return (legalMaxWeeklyMinutes <= 45 * 60 ? 170 : 140) * 60;
}

/** Monday of the date's week. */
export function weekStart(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/**
 * Überzeit per day in [from, to): minutes of each day's attendance that lie beyond the weekly
 * maximum. Weeks starting before `from` count their earlier days from `attendance` too, so it
 * should cover from `weekStart(from)`.
 */
export function legalOvertimeByDay(attendance: ReadonlyMap<string, number>, from: string, toExclusive: string, maxWeeklyMinutes: number): Map<string, number> {
  const out = new Map<string, number>();
  if (from >= toExclusive) return out;
  let week = '';
  let cumulative = 0;
  for (const date of datesBetween(weekStart(from), toExclusive)) {
    const monday = weekStart(date);
    if (monday !== week) {
      week = monday;
      cumulative = 0;
    }
    const before = Math.max(0, cumulative - maxWeeklyMinutes);
    cumulative += attendance.get(date) ?? 0;
    const excess = Math.max(0, cumulative - maxWeeklyMinutes) - before;
    if (date >= from && excess > 0) out.set(date, excess);
  }
  return out;
}

/** Total Überzeit in [from, to). */
export function legalOvertimeBetween(attendance: ReadonlyMap<string, number>, from: string, toExclusive: string, maxWeeklyMinutes: number): number {
  let total = 0;
  for (const minutes of legalOvertimeByDay(attendance, from, toExclusive, maxWeeklyMinutes).values()) total += minutes;
  return total;
}
