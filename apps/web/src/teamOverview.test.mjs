import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { absenceDaysInMonth, absenceOn, daysOfMonth, isWeekend, shiftMonth, totalsByCurrency } from './teamOverview.ts';

test('months: shift across years and list their days', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(daysOfMonth('2028-02').length, 29);
  assert.equal(daysOfMonth('2026-11')[0], '2026-11-01');
  assert.equal(isWeekend('2026-11-14'), true);
  assert.equal(isWeekend('2026-11-13'), false);
});

test('absence days in a month skip weekends and holidays and halve half days', () => {
  const base = { id: 'a', user_id: 'u', status: 'approved', absence_type: 'vacation', note: null };
  // Mon 2026-12-21 .. Fri 2027-01-01: in December, 21-25 and 28-31 are weekdays; 25 is a holiday.
  const xmas = { ...base, date_start: '2026-12-21', date_end: '2027-01-01', half_day: false };
  assert.equal(absenceDaysInMonth(xmas, '2026-12', new Set(['2026-12-25'])), 8);
  assert.equal(absenceDaysInMonth({ ...xmas, date_start: '2026-12-22', date_end: '2026-12-22', half_day: true }, '2026-12', new Set()), 0.5);
});

test('the calendar shows the approved absence of a day before a pending one, never a rejected one', () => {
  const rows = [
    { id: 'p', user_id: 'u', date_start: '2026-11-02', date_end: '2026-11-06', status: 'pending', absence_type: 'vacation', half_day: false, note: null },
    { id: 'a', user_id: 'u', date_start: '2026-11-04', date_end: '2026-11-04', status: 'approved', absence_type: 'sickness', half_day: false, note: null },
    { id: 'r', user_id: 'u', date_start: '2026-11-09', date_end: '2026-11-09', status: 'rejected', absence_type: 'vacation', half_day: false, note: null },
  ];
  assert.equal(absenceOn(rows, 'u', '2026-11-04')?.id, 'a');
  assert.equal(absenceOn(rows, 'u', '2026-11-03')?.id, 'p');
  assert.equal(absenceOn(rows, 'u', '2026-11-09'), undefined);
  assert.equal(absenceOn(rows, 'other', '2026-11-04'), undefined);
});

test('totals by currency', () => {
  assert.deepEqual(totalsByCurrency([{ value: '10.5', currency: 'CHF' }, { value: 4, currency: 'EUR' }, { value: 2, currency: 'CHF' }]), [['CHF', 12.5], ['EUR', 4]]);
});
