import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addDays, overlappingWorkingDays, vacationDebitMinutes, workingDaysBetween } from '../../apps/api/src/balances.service';

test('workingDaysBetween counts only Mon-Fri in [start, end)', () => {
  // 2026-09-01 is a Tuesday; 2026-09-01..2026-09-08 (exclusive) is Tue..Sun = 5 working days (Tue-Fri + next Mon excluded)
  assert.equal(workingDaysBetween('2026-09-01', '2026-09-08'), 5);
  // A full calendar month, September 2026 (Tue 1st .. Wed 30th inclusive == exclusive end 2026-10-01): 22 working days
  assert.equal(workingDaysBetween('2026-09-01', '2026-10-01'), 22);
  // Empty range
  assert.equal(workingDaysBetween('2026-09-01', '2026-09-01'), 0);
  // A single weekend day
  assert.equal(workingDaysBetween('2026-09-05', '2026-09-06'), 0); // Saturday
});

test('addDays shifts a YYYY-MM-DD date forward', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-09-01', 0), '2026-09-01');
});

test('overlappingWorkingDays clips an absence range to the period range', () => {
  // Absence entirely inside the period: Mon 2026-09-07 .. Fri 2026-09-11 (5 working days), period = September
  assert.equal(overlappingWorkingDays('2026-09-07', '2026-09-11', '2026-09-01', '2026-10-01'), 5);
  // Absence spanning the period boundary: only the days inside [periodStart, periodEnd) count —
  // Mon 28, Tue 29, Wed 30 (Oct 1-5 falls outside September and isn't counted)
  assert.equal(overlappingWorkingDays('2026-09-28', '2026-10-05', '2026-09-01', '2026-10-01'), 3);
  // Absence entirely outside the period
  assert.equal(overlappingWorkingDays('2026-08-01', '2026-08-05', '2026-09-01', '2026-10-01'), 0);
});

test('vacationDebitMinutes: a full single working day debits the org day-hours', () => {
  // 2026-09-07 is a Monday.
  assert.equal(vacationDebitMinutes('2026-09-07', '2026-09-07', false, 8), 8 * 60);
});

test('vacationDebitMinutes: a half single working day debits half the org day-hours', () => {
  assert.equal(vacationDebitMinutes('2026-09-07', '2026-09-07', true, 8), 4 * 60);
});

test('vacationDebitMinutes: a multi-day range debits day-hours per working day', () => {
  // Mon 2026-09-07 .. Fri 2026-09-11 = 5 working days.
  assert.equal(vacationDebitMinutes('2026-09-07', '2026-09-11', false, 8), 5 * 8 * 60);
});

test('vacationDebitMinutes: a single weekend day debits nothing', () => {
  assert.equal(vacationDebitMinutes('2026-09-05', '2026-09-05', false, 8), 0); // Saturday
  assert.equal(vacationDebitMinutes('2026-09-05', '2026-09-05', true, 8), 0);
});
