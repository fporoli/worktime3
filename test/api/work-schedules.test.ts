import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WorkSchedulesController } from '../../apps/api/src/work-schedules.controller';
import { WorkTimeModelService, localDate, parseWorkTimeSettings } from '../../apps/api/src/work-time-model.service';
import type { DbService } from '../../apps/api/src/db.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

const versions = { record: async () => {} } as unknown as VersionsService;

/**
 * WorkSchedulesController over a fake db: `permissions` are the caller's ids (a member with
 * none if empty); `locked` makes the timesheet lock query find a settled period.
 */
function setup(opts: { permissions?: string[]; locked?: boolean }) {
  const inserted: any[] = [];
  const db: any = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('JOIN membership_roles')) {
        const ids = opts.permissions?.length ? opts.permissions : [null];
        return { rows: ids.map((permission_id) => ({ name: 'member', permission_id })) };
      }
      if (text.includes('FROM timesheet_periods')) return { rows: opts.locked ? [{ '?column?': 1 }] : [] };
      // isActiveMember (an `all` grant covers active members): everyone is one here.
      if (text.includes('FROM organization_memberships WHERE')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    },
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: () => ({ returning: async () => { inserted.push(v); return [{ id: 'ws-1' }]; } }),
      }),
    }),
  };
  const controller = new WorkSchedulesController({ getDb: () => db } as unknown as DbService, new WorkTimeModelService(), versions);
  const req = { user: { kind: 'local', sub: 'caller' } } as unknown as AuthenticatedRequest;
  return { controller, req, inserted };
}

const schedule = { validFrom: '2026-12-01', workloadPercent: 80, dayMinutes: [480, 480, 480, 480, 0, 0, 0] };

test('saveSchedule needs edit on section.workTime.schedule for that person', async () => {
  const { controller, req, inserted } = setup({ permissions: ['nav.users:see:all', 'section.workTime.schedule:see:all'] });
  assert.deepEqual(await controller.saveSchedule('org-1', 'user-2', schedule, req), { ok: false, error: 'forbidden' });
  assert.equal(inserted.length, 0);
});

test('saveSchedule validates and refuses settled months', async () => {
  const grants = ['nav.users:edit:all', 'section.workTime.schedule:edit:all'];
  const editor = setup({ permissions: grants });
  assert.deepEqual(await editor.controller.saveSchedule('org-1', 'user-2', { ...schedule, workloadPercent: 150 }, editor.req), { ok: false, error: 'invalid-workload' });
  const locked = setup({ permissions: grants, locked: true });
  assert.deepEqual(await locked.controller.saveSchedule('org-1', 'user-2', schedule, locked.req), { ok: false, error: 'period-locked' });
  assert.equal(editor.inserted.length + locked.inserted.length, 0);
});

test('saveSchedule stores the schedule for an editor', async () => {
  const { controller, req, inserted } = setup({ permissions: ['nav.users:edit:all', 'section.workTime.schedule:edit:all'] });
  assert.deepEqual(await controller.saveSchedule('org-1', 'user-2', schedule, req), { ok: true, id: 'ws-1' });
  assert.deepEqual(inserted[0], { organization_id: 'org-1', user_id: 'user-2', valid_from: '2026-12-01', workload_percent: '80', day_minutes: [480, 480, 480, 480, 0, 0, 0] });
});

test('organization settings and holidays need Organization settings edit', async () => {
  const { controller, req } = setup({ permissions: ['nav.orgSettings:see:all'] });
  assert.deepEqual(await controller.setOrgSettings('org-1', { holidayRegion: 'ZH' }, req), { ok: false, error: 'forbidden' });
  assert.deepEqual(await controller.saveHoliday('org-1', { date: '2026-12-24' }, req), { ok: false, error: 'forbidden' });
  const admin = setup({ permissions: ['nav.orgSettings:edit:all'] });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { holidayRegion: 'XX' }, admin.req), { ok: false, error: 'invalid-region' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { vacationDaysPerYear: 400 }, admin.req), { ok: false, error: 'invalid-vacation-days' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { overtimeAlertMinutes: 1.5 }, admin.req), { ok: false, error: 'invalid-alert' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { balancesStartDate: '2026-13-01' }, admin.req), { ok: false, error: 'invalid-start-date' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { legalMaxWeeklyMinutes: 1000 }, admin.req), { ok: false, error: 'invalid-legal-max' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { legalOvertimeYearLimitMinutes: -5 }, admin.req), { ok: false, error: 'invalid-legal-limit' });
  assert.deepEqual(await admin.controller.saveHoliday('org-1', { date: '2026-02-30' }, admin.req), { ok: false, error: 'invalid-date' });
  assert.deepEqual(await admin.controller.saveHoliday('org-1', { date: '2026-12-24', fraction: 0.3 }, admin.req), { ok: false, error: 'invalid-fraction' });
});

test('parseWorkTimeSettings applies defaults and ignores bad values', () => {
  assert.deepEqual(parseWorkTimeSettings({}), {
    fullTimeWeeklyMinutes: 2400,
    holidayRegion: null,
    projectTimeToleranceMinutes: 15,
    vacationDaysPerYear: 25,
    overtimeAlertMinutes: 3000,
    undertimeAlertMinutes: 1200,
    balancesStartDate: null,
    legalMaxWeeklyMinutes: 2700,
    legalOvertimeYearLimitMinutes: 10200,
  });
  assert.deepEqual(
    parseWorkTimeSettings({
      fullTimeWeeklyMinutes: 2520,
      holidayRegion: 'ZH',
      projectTimeToleranceMinutes: 0,
      vacationDaysPerYear: 20,
      overtimeAlertMinutes: 600,
      undertimeAlertMinutes: 0,
      balancesStartDate: '2026-01-01',
      legalMaxWeeklyMinutes: 3000,
    }),
    {
      fullTimeWeeklyMinutes: 2520,
      holidayRegion: 'ZH',
      projectTimeToleranceMinutes: 0,
      vacationDaysPerYear: 20,
      overtimeAlertMinutes: 600,
      undertimeAlertMinutes: 0,
      balancesStartDate: '2026-01-01',
      legalMaxWeeklyMinutes: 3000,
      legalOvertimeYearLimitMinutes: 8400,
    },
  );
  assert.equal(parseWorkTimeSettings({ holidayRegion: 'XX' }).holidayRegion, null);
  assert.equal(parseWorkTimeSettings({ vacationDaysPerYear: -1 }).vacationDaysPerYear, 25);
  assert.equal(parseWorkTimeSettings({ balancesStartDate: '2026-02-30' }).balancesStartDate, null);
});

test('localDate uses the time zone', () => {
  assert.equal(localDate('2026-11-10T23:30:00Z', 'Europe/Zurich'), '2026-11-11');
  assert.equal(localDate('2026-11-10T23:30:00Z', 'UTC'), '2026-11-10');
  assert.equal(localDate('2026-11-10T23:30:00Z', 'Not/AZone'), '2026-11-10');
});

test('checkProjectTime compares the day\'s project time with its attendance', async () => {
  const service = new WorkTimeModelService();
  const stub = service as any;
  stub.timeZone = async () => 'Europe/Zurich';
  stub.settings = async () => ({ fullTimeWeeklyMinutes: 2400, holidayRegion: null, projectTimeToleranceMinutes: 15 });
  stub.projectMinutesOn = async () => 120; // already booked that day
  stub.attendanceByDay = async () => new Map([['2026-11-10', 240]]);
  const db = {} as any;
  // 120 booked + 2h new = 240 <= 240 + 15.
  assert.deepEqual(await service.checkProjectTime(db, 'org', 'u', '2026-11-10T08:00:00Z', '2026-11-10T10:00:00Z'), { ok: true });
  // 120 booked + 3h new = 300 > 255.
  assert.deepEqual(await service.checkProjectTime(db, 'org', 'u', '2026-11-10T08:00:00Z', '2026-11-10T11:00:00Z'), {
    ok: false,
    error: 'project-exceeds-attendance',
    date: '2026-11-10',
    projectMinutes: 300,
    attendanceMinutes: 240,
    toleranceMinutes: 15,
  });
});
