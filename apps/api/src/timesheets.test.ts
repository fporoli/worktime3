import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nextMonthStart } from './timesheets.controller';

test('nextMonthStart rolls over within and across years', () => {
  assert.equal(nextMonthStart('2026-09-01'), '2026-10-01');
  assert.equal(nextMonthStart('2026-01-01'), '2026-02-01');
  assert.equal(nextMonthStart('2026-12-01'), '2027-01-01');
});
