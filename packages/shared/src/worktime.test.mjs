import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANTONS,
  defaultLegalOvertimeYearLimit,
  legalOvertimeByDay,
  weekStart,
  HOLIDAY_KEYS,
  HOLIDAY_NAMES,
  cantonHolidays,
  dayMinutesFor,
  dayTarget,
  dayTargets,
  defaultSchedule,
  easterSunday,
  holidayName,
  holidaysBetween,
  monthStart,
  monthsBetween,
  nextMonth,
  roundDays,
  summarizeDays,
  vacationEntitlement,
  projectTimeWithinAttendance,
  scheduleOn,
  sumTargets,
  validateSchedule,
  weekdayIndex,
} from './worktime.ts';

test('easterSunday matches known dates', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
});

test('weekdayIndex is Monday-based', () => {
  assert.equal(weekdayIndex('2026-11-09'), 0); // Monday
  assert.equal(weekdayIndex('2026-11-15'), 6); // Sunday
});

test('dayMinutesFor spreads a workload over the working days', () => {
  assert.deepEqual(dayMinutesFor(2520, 100, [true, true, true, true, true, false, false]), [504, 504, 504, 504, 504, 0, 0]);
  assert.deepEqual(dayMinutesFor(2520, 80, [true, true, true, true, false, false, false]), [504, 504, 504, 504, 0, 0, 0]);
  // 2400 * 50% = 1200 over 3 days: 400 each.
  assert.deepEqual(dayMinutesFor(2400, 50, [true, false, true, false, true, false, false]), [400, 0, 400, 0, 400, 0, 0]);
  // Remainder goes to the first working days: 100 minutes over 3 days = 34, 33, 33.
  assert.deepEqual(dayMinutesFor(100, 100, [true, true, true, false, false, false, false]), [34, 33, 33, 0, 0, 0, 0]);
  assert.deepEqual(dayMinutesFor(2400, 100, [false, false, false, false, false, false, false]), [0, 0, 0, 0, 0, 0, 0]);
});

test('scheduleOn picks the latest schedule starting on or before the date', () => {
  const fallback = defaultSchedule(2400);
  const full = { validFrom: '2026-01-01', workloadPercent: 100, dayMinutes: [480, 480, 480, 480, 480, 0, 0] };
  const part = { validFrom: '2026-03-01', workloadPercent: 80, dayMinutes: [480, 480, 480, 480, 0, 0, 0] };
  assert.equal(scheduleOn('2025-12-31', [part, full], fallback), fallback);
  assert.equal(scheduleOn('2026-02-28', [part, full], fallback), full);
  assert.equal(scheduleOn('2026-03-01', [part, full], fallback), part);
});

test('validateSchedule checks date, workload and minutes', () => {
  const ok = validateSchedule({ validFrom: '2026-03-01', workloadPercent: 80, dayMinutes: [480, 480, 480, 480, 0, 0, 0] });
  assert.equal(ok.ok, true);
  assert.deepEqual(validateSchedule({ validFrom: '2026-02-30', workloadPercent: 80, dayMinutes: [0, 0, 0, 0, 0, 0, 0] }), { ok: false, error: 'invalid-date' });
  assert.deepEqual(validateSchedule({ validFrom: '2026-03-01', workloadPercent: 120, dayMinutes: [0, 0, 0, 0, 0, 0, 0] }), { ok: false, error: 'invalid-workload' });
  assert.deepEqual(validateSchedule({ validFrom: '2026-03-01', workloadPercent: 80, dayMinutes: [0, 0, 0] }), { ok: false, error: 'invalid-day-minutes' });
  assert.deepEqual(validateSchedule({ validFrom: '2026-03-01', workloadPercent: 80, dayMinutes: [2000, 0, 0, 0, 0, 0, 0] }), { ok: false, error: 'invalid-day-minutes' });
});

test('cantonHolidays: Zurich 2026', () => {
  const zh = cantonHolidays(2026, 'ZH').map((h) => `${h.date} ${h.key}`);
  assert.deepEqual(zh, [
    '2026-01-01 newYear',
    '2026-01-02 berchtold',
    '2026-04-03 goodFriday',
    '2026-04-06 easterMonday',
    '2026-05-01 labourDay',
    '2026-05-14 ascension',
    '2026-05-25 whitMonday',
    '2026-08-01 nationalDay',
    '2026-12-25 christmas',
    '2026-12-26 stStephen',
  ]);
});

test('cantonHolidays: canton-specific days', () => {
  const keys = (c, y = 2026) => cantonHolidays(y, c).map((h) => h.key);
  assert.ok(!keys('VS').includes('goodFriday'));
  assert.ok(keys('TI').includes('epiphany') && keys('TI').includes('peterPaul'));
  assert.ok(keys('GE').includes('genevaRestoration') && !keys('GE').includes('stStephen'));
  // Jeûne genevois: Thursday after the first Sunday of September (2026-09-06) -> 2026-09-10.
  assert.ok(cantonHolidays(2026, 'GE').some((h) => h.key === 'genevaFast' && h.date === '2026-09-10'));
  // Lundi du Jeûne: Monday after the third Sunday of September (2026-09-20) -> 2026-09-21.
  assert.ok(cantonHolidays(2026, 'VD').some((h) => h.key === 'federalFastMonday' && h.date === '2026-09-21'));
  // Näfelser Fahrt 2026: first Thursday of April is 2026-04-02 = Maundy Thursday -> 2026-04-09.
  assert.ok(cantonHolidays(2026, 'GL').some((h) => h.key === 'naefelserFahrt' && h.date === '2026-04-09'));
  // Every canton has the national day and every key has names in all four languages.
  for (const c of CANTONS) assert.ok(keys(c).includes('nationalDay'), c);
  for (const k of HOLIDAY_KEYS) for (const l of ['en', 'de', 'fr', 'it']) assert.ok(HOLIDAY_NAMES[k]?.[l], `${k}.${l}`);
});

test('holidaysBetween applies organization rows on top of the canton', () => {
  const rows = [
    { date: '2026-12-24', name: 'Christmas Eve', fraction: 0.5, observed: true },
    { date: '2026-01-02', name: null, fraction: 1, observed: false },
    { date: '2026-05-01', name: null, fraction: 0.5, observed: true },
  ];
  const h = holidaysBetween('2026-01-01', '2027-01-01', 'ZH', rows);
  assert.equal(h.has('2026-01-02'), false);
  assert.deepEqual(h.get('2026-12-24'), { date: '2026-12-24', name: 'Christmas Eve', fraction: 0.5, source: 'organization' });
  assert.deepEqual(h.get('2026-05-01'), { date: '2026-05-01', key: 'labourDay', fraction: 0.5, source: 'organization' });
  assert.equal(holidayName(h.get('2026-05-01'), 'de'), 'Tag der Arbeit');
  // No canton: only the organization's days.
  assert.deepEqual([...holidaysBetween('2026-01-01', '2027-01-01', null, rows).keys()].sort(), ['2026-05-01', '2026-12-24']);
  // Range spanning a year boundary.
  assert.deepEqual([...holidaysBetween('2026-12-20', '2027-01-03', 'ZH', []).keys()], ['2026-12-25', '2026-12-26', '2027-01-01', '2027-01-02']);
});

test('dayTarget subtracts holidays and absences', () => {
  const s = { validFrom: '2026-01-01', workloadPercent: 100, dayMinutes: [504, 504, 504, 504, 504, 0, 0] };
  assert.deepEqual(dayTarget('2026-11-09', s, undefined, []), { date: '2026-11-09', scheduled: 504, holiday: 0, absence: 0, target: 504 });
  assert.equal(dayTarget('2026-11-14', s, undefined, []).target, 0); // Saturday
  assert.equal(dayTarget('2026-11-09', s, { fraction: 1 }, []).target, 0);
  assert.deepEqual(dayTarget('2026-11-09', s, { fraction: 0.5 }, []), { date: '2026-11-09', scheduled: 504, holiday: 252, absence: 0, target: 252 });
  const vacation = { dateStart: '2026-11-09', dateEnd: '2026-11-10', halfDay: false };
  assert.equal(dayTarget('2026-11-10', s, undefined, [vacation]).target, 0);
  assert.equal(dayTarget('2026-11-11', s, undefined, [vacation]).target, 504);
  const half = { dateStart: '2026-11-09', dateEnd: '2026-11-09', halfDay: true };
  assert.deepEqual(dayTarget('2026-11-09', s, undefined, [half]), { date: '2026-11-09', scheduled: 504, holiday: 0, absence: 252, target: 252 });
  // Half-day absence on a half-day holiday: nothing left to work.
  assert.equal(dayTarget('2026-11-09', s, { fraction: 0.5 }, [half]).target, 0);
});

test('dayTargets over a month follows schedule changes and holidays', () => {
  const model = {
    schedules: [{ validFrom: '2026-05-18', workloadPercent: 50, dayMinutes: [240, 240, 240, 240, 240, 0, 0] }],
    fallback: defaultSchedule(2400),
    holidays: holidaysBetween('2026-05-01', '2026-06-01', 'ZH', []),
    absences: [],
  };
  const days = dayTargets('2026-05-01', '2026-06-01', model);
  assert.equal(days.length, 31);
  // May 2026, ZH: 21 weekdays; holidays 1 (Fri), 14 (Thu), 25 (Mon). Until the 15th: 11 weekdays - 2 holidays = 9 x 480;
  // from the 18th: 10 weekdays - 1 holiday = 9 x 240.
  assert.equal(sumTargets(days), 9 * 480 + 9 * 240);
});

test('projectTimeWithinAttendance allows the tolerance', () => {
  assert.equal(projectTimeWithinAttendance(240, 240, 15), true);
  assert.equal(projectTimeWithinAttendance(255, 240, 15), true);
  assert.equal(projectTimeWithinAttendance(256, 240, 15), false);
  assert.equal(projectTimeWithinAttendance(60, 0, 15), false);
  assert.equal(projectTimeWithinAttendance(10, 0, 15), true);
});

test('dayTarget records the absence type', () => {
  const s = defaultSchedule(2400);
  const day = dayTarget('2026-11-10', s, undefined, [{ dateStart: '2026-11-10', dateEnd: '2026-11-10', halfDay: true, type: 'vacation' }]);
  assert.equal(day.absence, 240);
  assert.equal(day.absenceType, 'vacation');
  assert.equal(dayTarget('2026-11-11', s, undefined, []).absenceType, undefined);
});

test('month helpers', () => {
  assert.equal(monthStart('2026-11-30'), '2026-11-01');
  assert.equal(nextMonth('2026-12-01'), '2027-01-01');
  assert.deepEqual(monthsBetween('2026-11-15', '2027-02-01'), ['2026-11-01', '2026-12-01', '2027-01-01']);
});

test('summarizeDays totals targets, absences per type and vacation in full-time days', () => {
  const s = defaultSchedule(2400);
  const days = dayTargets('2026-11-09', '2026-11-14', {
    schedules: [],
    fallback: s,
    holidays: new Map(),
    absences: [
      { dateStart: '2026-11-10', dateEnd: '2026-11-11', halfDay: false, type: 'vacation' },
      { dateStart: '2026-11-13', dateEnd: '2026-11-13', halfDay: false, type: 'sick' },
    ],
  });
  const summary = summarizeDays(days, new Map([['2026-11-09', 500], ['2026-11-12', 470]]), 2400);
  assert.equal(summary.scheduled, 5 * 480);
  assert.equal(summary.target, 2 * 480);
  assert.equal(summary.actual, 970);
  assert.equal(summary.delta, 10);
  assert.deepEqual(summary.absenceByType, { vacation: 960, sick: 480 });
  assert.equal(summary.vacationDays, 2);
});

test('summarizeDays: a part-timer half day off is half a vacation day', () => {
  const half = { validFrom: '2026-01-01', workloadPercent: 50, dayMinutes: dayMinutesFor(2400, 50, [true, true, true, true, true, false, false]) };
  const days = dayTargets('2026-11-10', '2026-11-11', { schedules: [half], fallback: defaultSchedule(2400), holidays: new Map(), absences: [{ dateStart: '2026-11-10', dateEnd: '2026-11-10', halfDay: false, type: 'vacation' }] });
  assert.equal(summarizeDays(days, new Map(), 2400).vacationDays, 0.5);
});

test('vacationEntitlement prorates by workload and membership', () => {
  const full = defaultSchedule(2400);
  assert.equal(vacationEntitlement(2026, 25, [], full), 25);
  const half = { validFrom: '2026-01-01', workloadPercent: 50, dayMinutes: dayMinutesFor(2400, 50, [true, true, true, true, true, false, false]) };
  assert.equal(vacationEntitlement(2026, 25, [half], full), 12.5);
  // joins 1 July (184 of 365 days)
  assert.equal(vacationEntitlement(2026, 25, [], full, '2026-07-01'), roundDays((25 * 184) / 365));
  // leaves end of March
  assert.equal(vacationEntitlement(2026, 25, [], full, null, '2026-04-01'), roundDays((25 * 90) / 365));
  assert.equal(vacationEntitlement(2026, 25, [], full, '2027-01-01'), 0);
});

test('legalOvertimeByDay: the excess lands on the day the week passes its maximum', () => {
  // Mon 2026-10-05 … : 10 h, 10 h, 10 h, 10 h, 10 h → 50 h, 5 h beyond 45 h, all on Friday.
  const att = new Map(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((d) => [d, 600]));
  assert.deepEqual([...legalOvertimeByDay(att, '2026-10-05', '2026-10-12', 2700)], [['2026-10-09', 300]]);
  // Starting mid-week still counts the earlier days of that week.
  assert.deepEqual([...legalOvertimeByDay(att, '2026-10-09', '2026-10-12', 2700)], [['2026-10-09', 300]]);
  // Saturday work in the same week adds fully.
  att.set('2026-10-10', 120);
  assert.equal(legalOvertimeByDay(att, '2026-10-05', '2026-10-12', 2700).get('2026-10-10'), 120);
  // A new week starts from zero.
  att.set('2026-10-12', 600);
  assert.equal(legalOvertimeByDay(att, '2026-10-05', '2026-10-19', 2700).has('2026-10-12'), false);
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
});

test('defaultLegalOvertimeYearLimit: 170 h at 45 h a week, 140 h at 50 h', () => {
  assert.equal(defaultLegalOvertimeYearLimit(2700), 170 * 60);
  assert.equal(defaultLegalOvertimeYearLimit(3000), 140 * 60);
});
