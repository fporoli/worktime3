import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  balanceRangeEnd,
  computeYearBalances,
  reportAlerts,
  type BalanceInputs,
  type ClosedMonth,
  type MonthBalance,
} from '../../apps/api/src/balances.service';
import { BalancesController, validateAdjustment } from '../../apps/api/src/balances.controller';
import type { BalancesService } from '../../apps/api/src/balances.service';
import type { DbService } from '../../apps/api/src/db.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';
import { dayMinutesFor, defaultSchedule } from '@worktime3/shared/worktime';

const FULL = defaultSchedule(2400);

/** Inputs for a person working 8h on each day from `start`, with overrides. */
function inputs(over: Partial<BalanceInputs> & { workedDays?: string[] } = {}): BalanceInputs {
  const attendance = new Map((over.workedDays ?? []).map((d) => [d, 480]));
  return {
    year: 2026,
    today: '2026-11-11',
    start: '2026-10-01',
    until: null,
    settings: { fullTimeWeeklyMinutes: 2400, vacationDaysPerYear: 25, legalMaxWeeklyMinutes: 2700, legalOvertimeYearLimitMinutes: 10200 },
    model: { schedules: [], fallback: FULL, holidays: new Map(), absences: [] },
    attendance,
    closed: [],
    periodStatus: new Map(),
    adjustments: [],
    entitlementOverrides: new Map(),
    ...over,
  };
}

/** Weekdays in [from, to). */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) < to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

test('balanceRangeEnd covers the year and the current month', () => {
  assert.equal(balanceRangeEnd(2026, '2026-11-11'), '2027-01-01');
  assert.equal(balanceRangeEnd(2025, '2026-11-11'), '2026-12-01');
});

test('computeYearBalances: months before the start are empty, open months run live up to today', () => {
  const b = computeYearBalances(inputs({ workedDays: weekdays('2026-10-01', '2026-11-11') }));
  assert.equal(b.months.length, 12);
  assert.equal(b.months[8].status, 'before-start'); // September
  const oct = b.months[9];
  assert.equal(oct.status, 'open');
  assert.equal(oct.target, 22 * 480);
  assert.equal(oct.delta, 0);
  const nov = b.months[10];
  assert.equal(nov.status, 'current');
  assert.equal(nov.target, 7 * 480); // 2-10 November, before today
  assert.equal(nov.monthTarget, 21 * 480);
  assert.equal(b.months[11].status, 'future');
  assert.equal(b.overtime.pendingMinutes, 0);
  assert.equal(b.overtime.pendingSince, '2026-10-01');
});

test('computeYearBalances: closed months keep their numbers and count as booked', () => {
  const closed: ClosedMonth[] = [
    { month: '2026-10-01', closedAt: '2026-11-02T10:00:00Z', summary: { scheduled: 10560, holiday: 0, absenceByType: {}, target: 10560, actual: 10865, delta: 305, vacationDays: 0 } },
  ];
  // November: worked 9h on each of 7 days → +420 pending
  const attendance = new Map(weekdays('2026-11-01', '2026-11-11').map((d) => [d, 540]));
  const b = computeYearBalances(inputs({ closed, attendance }));
  assert.equal(b.months[9].status, 'closed');
  assert.equal(b.months[9].overtimeBalance, 305);
  assert.equal(b.months[10].overtimeBalance, 305 + 420);
  assert.equal(b.overtime.bookedMinutes, 305);
  assert.equal(b.overtime.pendingMinutes, 420);
  assert.equal(b.overtime.pendingSince, '2026-11-01');
  assert.equal(b.overtime.opening, 0);
  assert.equal(b.overtime.closing, 725);
});

test('computeYearBalances: adjustments move the running balance from their month', () => {
  const b = computeYearBalances(
    inputs({
      workedDays: weekdays('2026-10-01', '2026-11-11'),
      adjustments: [
        { id: 'a1', balance: 'overtime', kind: 'opening', effectiveDate: '2026-09-15', amount: 600, note: null },
        { id: 'a2', balance: 'overtime', kind: 'payout', effectiveDate: '2026-11-05', amount: -120, note: null },
      ],
    }),
  );
  assert.equal(b.months[8].overtimeBalance, 600); // September: before the start, but the opening counts
  assert.equal(b.months[9].overtimeBalance, 600);
  assert.equal(b.months[10].overtimeBalance, 480);
  assert.equal(b.overtime.bookedMinutes, 480);
});

test('computeYearBalances: the next year opens with the previous closing', () => {
  const b = computeYearBalances(
    inputs({
      year: 2027,
      today: '2027-01-20',
      attendance: new Map(weekdays('2026-10-01', '2027-01-20').map((d) => [d, 500])),
    }),
  );
  // 2026: 22 + 21 + 23 weekdays × 20 min; holidays are not modeled here
  assert.equal(b.overtime.opening, (22 + 21 + 23) * 20);
  assert.equal(b.months[0].status, 'current');
});

test('computeYearBalances: vacation entitlement prorated from the start, taken and planned in days', () => {
  const b = computeYearBalances(
    inputs({
      model: {
        schedules: [],
        fallback: FULL,
        holidays: new Map(),
        absences: [
          { dateStart: '2026-10-12', dateEnd: '2026-10-16', halfDay: false, type: 'vacation' },
          { dateStart: '2026-12-21', dateEnd: '2026-12-23', halfDay: false, type: 'vacation' },
          { dateStart: '2026-11-03', dateEnd: '2026-11-03', halfDay: false, type: 'sick' },
        ],
      },
    }),
  );
  // 1 Oct - 31 Dec = 92 of 365 days
  assert.equal(b.vacation.entitlement, Math.round(((25 * 92) / 365) * 100) / 100);
  assert.equal(b.vacation.taken, 5);
  assert.equal(b.vacation.planned, 3);
  assert.equal(b.vacation.remaining, Math.round((b.vacation.entitlement - 8) * 100) / 100);
  assert.deepEqual(b.months[9].absenceByType, { vacation: 2400 });
  assert.equal(b.months[10].absenceByType.sick, 480);
});

test('computeYearBalances: carry-over, overrides and vacation adjustments', () => {
  const b = computeYearBalances(
    inputs({
      year: 2027,
      today: '2027-01-20',
      start: '2026-01-01',
      entitlementOverrides: new Map([[2026, 20]]),
      adjustments: [{ id: 'v1', balance: 'vacation', kind: 'correction', effectiveDate: '2026-06-30', amount: 2, note: null }],
      model: { schedules: [], fallback: FULL, holidays: new Map(), absences: [{ dateStart: '2026-07-06', dateEnd: '2026-07-17', halfDay: false, type: 'vacation' }] },
    }),
  );
  assert.equal(b.vacation.carryOver, 20 + 2 - 10);
  assert.equal(b.vacation.entitlement, 25);
  assert.equal(b.vacation.entitlementOverridden, false);
  assert.equal(b.vacation.remaining, 37);
});

test('computeYearBalances: each month carries over the previous month balances', () => {
  const b = computeYearBalances(
    inputs({
      year: 2027,
      today: '2027-03-15',
      start: '2026-01-01',
      entitlementOverrides: new Map([[2026, 20]]),
      attendance: new Map(weekdays('2026-01-01', '2027-03-15').map((d) => [d, 500])),
      adjustments: [{ id: 'v1', balance: 'vacation', kind: 'correction', effectiveDate: '2027-02-10', amount: 1.5, note: null }],
      model: {
        schedules: [],
        fallback: FULL,
        holidays: new Map(),
        absences: [
          { dateStart: '2026-07-06', dateEnd: '2026-07-10', halfDay: false, type: 'vacation' },
          { dateStart: '2027-02-15', dateEnd: '2027-02-16', halfDay: false, type: 'vacation' },
          { dateStart: '2027-04-01', dateEnd: '2027-04-01', halfDay: false, type: 'vacation' },
        ],
      },
    }),
  );
  const [jan, feb, mar, apr, may] = b.months;
  // Overtime: each month opens with the previous month's closing.
  assert.equal(jan.overtimeOpening, b.overtime.opening);
  assert.equal(feb.overtimeOpening, jan.overtimeBalance);
  assert.equal(feb.overtimeBalance, feb.overtimeOpening + feb.delta);
  // Vacation: 2026 leaves 20 − 5 = 15; 2027's 25 days are credited in January.
  assert.equal(jan.vacationOpening, 15);
  assert.equal(jan.vacationCredited, 25);
  assert.equal(jan.vacationBalance, 40);
  assert.equal(feb.vacationOpening, 40);
  assert.equal(feb.vacationAdjustmentDays, 1.5);
  assert.equal(feb.vacationBalance, 40 + 1.5 - 2);
  assert.equal(mar.vacationCredited, 0);
  assert.equal(mar.vacationBalance, 39.5);
  assert.equal(apr.vacationBalance, 38.5); // planned vacation counts too
  assert.equal(may.vacationOpening, 38.5);
  assert.equal(b.months[11].vacationBalance, b.vacation.remaining);
});

test('computeYearBalances: part-time workload halves entitlement', () => {
  const half = { validFrom: '2026-01-01', workloadPercent: 50, dayMinutes: dayMinutesFor(2400, 50, [true, true, true, true, true, false, false]) };
  const b = computeYearBalances(inputs({ start: '2026-01-01', model: { schedules: [half], fallback: FULL, holidays: new Map(), absences: [] } }));
  assert.equal(b.vacation.entitlement, 12.5);
});

test('computeYearBalances: a submitted month shows its timesheet status', () => {
  const b = computeYearBalances(inputs({ periodStatus: new Map([['2026-10-01', 'submitted']]) }));
  assert.equal(b.months[9].status, 'submitted');
});

function month(over: Partial<MonthBalance>): MonthBalance {
  return {
    month: '2026-10-01', status: 'open', closedAt: null, scheduled: 0, holiday: 0, absenceByType: {}, target: 0, actual: 0, delta: 0,
    vacationDays: 0, monthTarget: 0, plannedVacationDays: 0, adjustmentMinutes: 0, overtimeOpening: 0, overtimeBalance: 0,
    vacationOpening: 0, vacationCredited: 0, vacationAdjustmentDays: 0, vacationBalance: 0, legalOvertimeMinutes: 0, legalOvertimeAdjustments: 0, legalOvertimeBalance: 0, ...over,
  };
}
const alertSettings = { overtimeAlertMinutes: 3000, undertimeAlertMinutes: 1200, legalOvertimeYearLimitMinutes: 10200 };

test('reportAlerts flags balances beyond the thresholds and missing timesheets', () => {
  assert.deepEqual(reportAlerts(month({ overtimeBalance: 3001 }), 5, '2026-11-11', alertSettings), ['overtime-high', 'not-submitted']);
  assert.deepEqual(reportAlerts(month({ overtimeBalance: -1201, status: 'closed' }), 5, '2026-11-11', alertSettings), ['overtime-low']);
  assert.deepEqual(reportAlerts(month({ status: 'submitted' }), -1, '2026-11-11', alertSettings), ['awaiting-approval', 'vacation-negative']);
  assert.deepEqual(reportAlerts(month({ month: '2026-11-01', status: 'current' }), 0, '2026-11-11', alertSettings), []);
  assert.deepEqual(reportAlerts(month({ status: 'rejected' }), 0, '2026-11-11', alertSettings), ['rejected']);
  assert.deepEqual(reportAlerts(month({ status: 'closed', legalOvertimeMinutes: 60 }), 0, '2026-11-11', alertSettings, 600), ['legal-overtime']);
  assert.deepEqual(reportAlerts(month({ status: 'closed', legalOvertimeMinutes: 60 }), 0, '2026-11-11', alertSettings, 10201), ['legal-overtime-limit']);
});

test('computeYearBalances: Überzeit is the share beyond 45 h a week, kept as its own account', () => {
  // 2026-10-05 is a Monday. Week 1: 5 × 10 h = 50 h → 5 h Überzeit; week 2: 5 × 9 h = 45 h → none.
  const attendance = new Map([
    ...weekdays('2026-10-05', '2026-10-10').map((d) => [d, 600] as [string, number]),
    ...weekdays('2026-10-12', '2026-10-17').map((d) => [d, 540] as [string, number]),
  ]);
  const b = computeYearBalances(
    inputs({
      start: '2026-10-05',
      attendance,
      adjustments: [{ id: 'p1', balance: 'legal_overtime', kind: 'payout', effectiveDate: '2026-11-02', amount: -120, note: null }],
    }),
  );
  const [oct, nov] = [b.months[9], b.months[10]];
  assert.equal(oct.legalOvertimeMinutes, 300);
  assert.equal(oct.legalOvertimeBalance, 300);
  // The payout leaves both the Überzeit account and the total balance.
  assert.equal(nov.legalOvertimeAdjustments, -120);
  assert.equal(nov.legalOvertimeBalance, 180);
  assert.equal(nov.overtimeBalance, oct.overtimeBalance + nov.delta - 120);
  assert.deepEqual(
    { accrued: b.legalOvertime.accrued, adjustments: b.legalOvertime.adjustments, closing: b.legalOvertime.closing, limit: b.legalOvertime.yearLimitMinutes },
    { accrued: 300, adjustments: -120, closing: 180, limit: 10200 },
  );
});

test('computeYearBalances: a closed month keeps its frozen Überzeit, older closings compute it', () => {
  const summary = { scheduled: 0, holiday: 0, absenceByType: {}, target: 0, actual: 0, delta: 0, vacationDays: 0 };
  const attendance = new Map(weekdays('2026-10-05', '2026-10-10').map((d) => [d, 600] as [string, number]));
  const frozen = computeYearBalances(inputs({ attendance, closed: [{ month: '2026-10-01', closedAt: null, summary, legalOvertime: 42 }] }));
  assert.equal(frozen.months[9].legalOvertimeMinutes, 42);
  const legacy = computeYearBalances(inputs({ attendance, closed: [{ month: '2026-10-01', closedAt: null, summary, legalOvertime: null }] }));
  assert.equal(legacy.months[9].legalOvertimeMinutes, 300);
});

test('validateAdjustment', () => {
  const ok = { balance: 'overtime', kind: 'correction', effectiveDate: '2026-11-01', amount: 60 };
  assert.equal(validateAdjustment(ok), null);
  assert.equal(validateAdjustment({ ...ok, balance: 'sick' }), 'invalid-balance');
  assert.equal(validateAdjustment({ ...ok, kind: 'gift' }), 'invalid-kind');
  assert.equal(validateAdjustment({ ...ok, effectiveDate: '2026-11-31' }), 'invalid-date');
  assert.equal(validateAdjustment({ ...ok, amount: 0 }), 'invalid-amount');
  assert.equal(validateAdjustment({ ...ok, balance: 'vacation', amount: 2000 }), 'invalid-amount');
});

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

/** BalancesController over a fake db; `permissions` are the caller's ids, `reports` their direct reports. */
function setup(permissions: string[], reports: string[] = []) {
  const added: any[] = [];
  const db: any = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('JOIN membership_roles')) {
        const ids = permissions.length ? permissions : [null];
        return { rows: ids.map((permission_id) => ({ name: 'member', permission_id })) };
      }
      if (text.includes('manager_user_id')) return { rows: reports.map((user_id) => ({ user_id })) };
      if (text.includes('FROM organization_memberships WHERE')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    },
  };
  const balances = {
    year: async (_db: unknown, _org: string, userId: string) => ({ userId, overtime: { bookedMinutes: 1, pendingMinutes: 2, pendingSince: null }, vacation: { remaining: 3, planned: 0 } }),
    addAdjustment: async (_db: unknown, p: unknown) => { added.push(p); return 'adj-1'; },
    report: async (_db: unknown, _org: string, ids: unknown) => ids,
  } as unknown as BalancesService;
  const controller = new BalancesController({ getDb: () => db } as unknown as DbService, balances);
  const req = { user: { kind: 'local', sub: 'caller' } } as unknown as AuthenticatedRequest;
  return { controller, req, added };
}

test('balances: own always visible, others need nav.balances', async () => {
  const { controller, req } = setup([]);
  assert.equal((await controller.get('org-1', req))?.overtimeMinutes, 1);
  assert.equal(await controller.get('org-1', req, 'user-2'), null);
  assert.deepEqual(await controller.year('org-1', req, 'user-2'), { ok: false, error: 'forbidden' });
  const hr = setup(['nav.balances:see:all']);
  assert.equal((await hr.controller.year('org-1', hr.req, 'user-2')).ok, true);
});

test('balances: adjustments need edit beyond own', async () => {
  const body = { userId: 'caller', balance: 'overtime', kind: 'correction', effectiveDate: '2026-11-01', amount: 60 };
  const self = setup(['nav.balances:edit:own']);
  assert.deepEqual(await self.controller.addAdjustment('org-1', body, self.req), { ok: false, error: 'forbidden' });
  const hr = setup(['nav.balances:edit:all']);
  assert.deepEqual(await hr.controller.addAdjustment('org-1', { ...body, userId: 'user-2' }, hr.req), { ok: true, id: 'adj-1' });
  assert.equal(hr.added[0].actorUserId, 'caller');
  assert.deepEqual(await hr.controller.addAdjustment('org-1', { ...body, userId: 'user-2', amount: 0 }, hr.req), { ok: false, error: 'invalid-amount' });
});

test('balances report: month format checked, people limited to what the caller may list', async () => {
  const { controller, req } = setup([], ['user-3']);
  assert.deepEqual(await controller.report('org-1', req, '2026-13'), { ok: false, error: 'invalid-month', rows: [] });
  const res = await controller.report('org-1', req, '2026-10');
  assert.deepEqual([...(res.rows as unknown as string[])].sort(), ['caller', 'user-3']);
  const hr = setup(['nav.balances:see:all']);
  assert.equal((await hr.controller.report('org-1', hr.req, '2026-10')).rows as unknown, 'all');
});
