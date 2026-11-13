import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WorkTimeController } from '../../apps/api/src/work-time.controller';
import { ProjectTimeController } from '../../apps/api/src/project-time.controller';
import { TimesheetsController } from '../../apps/api/src/timesheets.controller';
import { ProjectTimesheetsController } from '../../apps/api/src/project-timesheets.controller';
import { canEditUserData } from '../../apps/api/src/access';
import type { DbService } from '../../apps/api/src/db.service';
import type { AuditService } from '../../apps/api/src/audit.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { WorkflowsService } from '../../apps/api/src/workflows.service';
import type { BalancesService } from '../../apps/api/src/balances.service';
import type { WorkTimeService } from '../../apps/api/src/work-time.service';
import type { ProjectTimeService } from '../../apps/api/src/project-time.service';
import type { WorkTimeModelService } from '../../apps/api/src/work-time-model.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

// Who may change time records: the person, their designated manager, and HR (an edit grant
// beyond own); never while the month is submitted or approved. Manager and HR reopen months.
//
// Cast: `emp` reports to `boss`; `peer` is another plain member; `hr` holds HR's grants.

const MEMBER = [{ name: 'member', permission_id: 'nav.workTime:edit:own' }, { name: 'member', permission_id: 'nav.time:edit:own' }];
const HR = [
  { name: 'hr', permission_id: 'nav.workTime:edit:all' },
  { name: 'hr', permission_id: 'nav.time:edit:all' },
  { name: 'hr', permission_id: 'nav.timesheet:edit:all' },
  { name: 'hr', permission_id: 'nav.projectTimesheet:edit:all' },
];
const ROLES: Record<string, { name: string; permission_id: string }[]> = { emp: MEMBER, boss: MEMBER, peer: MEMBER, hr: HR };
const MANAGER_OF: Record<string, string> = { emp: 'boss' };

function chunks(query: any): any[] {
  return query.queryChunks ?? [];
}
function sqlText(query: any): string {
  return chunks(query).map((c) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}
function sqlParams(query: any): any[] {
  return chunks(query).filter((c) => !Array.isArray(c?.value));
}

/** Answers access.ts's raw queries from the cast above; `locked` makes every month submitted. */
function fakeDb(opts: { locked?: boolean; row?: Record<string, unknown> } = {}) {
  const updates: any[] = [];
  const inserts: any[] = [];
  const db: any = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      const params = sqlParams(q);
      if (text.includes('LEFT JOIN role_permissions')) return { rows: ROLES[params[1]] ?? [] };
      if (text.includes('JOIN membership_roles')) return { rows: (ROLES[params[1]] ?? []).slice(0, 1) };
      if (text.includes('SELECT manager_user_id')) return { rows: [{ manager_user_id: MANAGER_OF[params[1]] ?? null }] };
      if (text.includes('SELECT 1 FROM organization_memberships')) return { rows: ROLES[params[1]] ? [{ '?column?': 1 }] : [] };
      if (text.includes('FROM timesheet_periods') || text.includes('FROM project_time_periods')) return { rows: opts.locked ? [{ '?column?': 1 }] : [] };
      return { rows: [] };
    },
    select: () => db,
    from: () => db,
    leftJoin: () => db,
    innerJoin: () => db,
    where: async () => (opts.row ? [opts.row] : []),
    update: () => ({ set: (v: any) => ({ where: async () => { updates.push(v); } }) }),
    delete: () => ({ where: async () => {} }),
    insert: () => ({ values: (v: any) => { inserts.push(v); return { returning: async () => [{ id: 'new' }] }; } }),
  };
  return { db, updates, inserts, service: { getDb: () => db } as unknown as DbService };
}

const as = (sub: string) => ({ user: { kind: 'local', sub } }) as unknown as AuthenticatedRequest;
const versions = { record: async () => {} } as unknown as VersionsService;
const audit = { record: async () => {} } as unknown as AuditService;

test('canEditUserData: the person, their manager and HR; not a peer', async () => {
  const { db } = fakeDb();
  assert.equal(await canEditUserData(db, 'org', 'emp', 'nav.workTime', 'emp'), true);
  assert.equal(await canEditUserData(db, 'org', 'boss', 'nav.workTime', 'emp'), true);
  assert.equal(await canEditUserData(db, 'org', 'hr', 'nav.workTime', 'emp'), true);
  assert.equal(await canEditUserData(db, 'org', 'peer', 'nav.workTime', 'emp'), false);
});

test('work time: manager and HR correct an entry while the month is open, a peer may not', async () => {
  const entry = { user_id: 'emp', organization_id: 'org', check_in: '2026-11-02T07:00:00Z', check_out: '2026-11-02T16:00:00Z' };
  const patch = { checkOut: '2026-11-02T17:00:00Z' };
  const controller = (locked = false) => new WorkTimeController(fakeDb({ row: entry, locked }).service, {} as WorkTimeService, versions);
  assert.deepEqual(await controller().update('w1', patch, as('boss')), { ok: true });
  assert.deepEqual(await controller().update('w1', patch, as('hr')), { ok: true });
  assert.deepEqual(await controller().update('w1', patch, as('peer')), { ok: false, error: 'forbidden' });
  // A submitted/approved month stays locked for everyone until it is reopened.
  assert.deepEqual(await controller(true).update('w1', patch, as('hr')), { ok: false, error: 'period-locked' });
  assert.deepEqual(await controller(true).remove('w1', as('boss')), { ok: false, error: 'period-locked' });
});

test('work time: a manual entry for someone else needs their manager or HR, and an open month', async () => {
  const body = { checkIn: '2026-11-03T07:00:00Z', checkOut: '2026-11-03T15:00:00Z' };
  const setup = (locked = false) => {
    const f = fakeDb({ locked });
    return { ...f, controller: new WorkTimeController(f.service, {} as WorkTimeService, versions) };
  };
  const ok = setup();
  assert.deepEqual(await ok.controller.addEntry('org', 'emp', body, as('hr')), { ok: true, id: 'new' });
  assert.equal(ok.inserts[0].user_id, 'emp');
  assert.deepEqual(await setup().controller.addEntry('org', 'emp', body, as('peer')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await setup(true).controller.addEntry('org', 'emp', body, as('boss')), { ok: false, error: 'period-locked' });
  assert.deepEqual(
    await setup().controller.addEntry('org', 'emp', { checkIn: body.checkOut, checkOut: body.checkIn }, as('emp')),
    { ok: false, error: 'invalid-range' },
  );
});

test('project time: booked for someone else only by their manager or HR', async () => {
  const workTime = { checkProjectTime: async () => ({ ok: true }) } as unknown as WorkTimeModelService;
  const body = { projectId: 'p1', startTime: '2026-11-02T08:00:00Z', endTime: '2026-11-02T10:00:00Z', userId: 'emp' };
  const setup = () => {
    const f = fakeDb({ row: { settings: {} } });
    return { ...f, controller: new ProjectTimeController(f.service, {} as ProjectTimeService, versions, workTime) };
  };
  const boss = setup();
  assert.deepEqual(await boss.controller.create('org', body, as('boss')), { ok: true, id: 'new' });
  assert.equal(boss.inserts[0].user_id, 'emp');
  assert.deepEqual(await setup().controller.create('org', body, as('peer')), { ok: false, error: 'forbidden' });
});

function timesheetSetup(status: string) {
  const f = fakeDb({ row: { organization_id: 'org', status, user_id: 'emp' } });
  const reopened: string[] = [];
  const balances = { reopenMonth: async (_db: unknown, id: string) => { reopened.push(id); } } as unknown as BalancesService;
  const controller = new TimesheetsController(f.service, audit, versions, {} as WorkflowsService, balances);
  return { ...f, reopened, controller };
}

test('monthly timesheet: manager and HR reopen it, the person does not', async () => {
  const boss = timesheetSetup('approved');
  assert.deepEqual(await boss.controller.reopen('ts1', as('boss')), { ok: true });
  assert.deepEqual(boss.reopened, ['ts1'], 'an approved month gives its balance back');
  assert.ok(boss.updates.some((u) => u.step_status === 'cancelled'), 'pending approvals and reopen requests are cancelled');
  assert.ok(boss.updates.some((u) => u.status === 'open'));

  const hr = timesheetSetup('submitted');
  assert.deepEqual(await hr.controller.reopen('ts1', as('hr')), { ok: true });
  assert.deepEqual(hr.reopened, [], 'a submitted month was never closed');

  assert.deepEqual(await timesheetSetup('approved').controller.reopen('ts1', as('emp')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await timesheetSetup('approved').controller.reopen('ts1', as('peer')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await timesheetSetup('open').controller.reopen('ts1', as('boss')), { ok: false, error: 'not-locked' });
});

test('project timesheet: the person’s manager and HR reopen a project month too', async () => {
  const period = { id: '11111111-1111-1111-1111-111111111111', organization_id: 'org', user_id: 'emp', owner_user_id: 'pm', status: 'approved' };
  const setup = () => {
    const f = fakeDb({ row: period });
    const workflowsSvc = { findPending: async () => null } as unknown as WorkflowsService;
    return { ...f, controller: new ProjectTimesheetsController(f.service, audit, versions, workflowsSvc) };
  };
  assert.deepEqual(await setup().controller.reopen(period.id, as('boss')), { ok: true });
  assert.deepEqual(await setup().controller.reopen(period.id, as('hr')), { ok: true });
  assert.deepEqual(await setup().controller.reopen(period.id, as('peer')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await setup().controller.reopen(period.id, as('emp')), { ok: false, error: 'forbidden' });
});
