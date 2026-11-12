import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ProjectTimesheetsController, projectApprover } from '../../apps/api/src/project-timesheets.controller';
import { ProjectTimeController } from '../../apps/api/src/project-time.controller';
import { isProjectPeriodLocked } from '../../apps/api/src/access';
import type { DbService } from '../../apps/api/src/db.service';
import type { AuditService } from '../../apps/api/src/audit.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { WorkflowsService } from '../../apps/api/src/workflows.service';
import type { ProjectTimeService } from '../../apps/api/src/project-time.service';
import type { WorkTimeModelService } from '../../apps/api/src/work-time-model.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

const versions = { record: async () => {} } as unknown as VersionsService;
const audit = { record: async () => {} } as unknown as AuditService;
const req = { user: { kind: 'local', sub: 'emp' } } as unknown as AuthenticatedRequest;

test('projectApprover: the owner, unless there is none or it is the submitter', () => {
  assert.equal(projectApprover('pm', 'emp'), 'pm');
  assert.equal(projectApprover(null, 'emp'), null);
  assert.equal(projectApprover('emp', 'emp'), null);
});

test('isProjectPeriodLocked: never without a project, else by the project month', async () => {
  let queries = 0;
  const db: any = { execute: async () => { queries++; return { rows: [{ '?column?': 1 }] }; } };
  assert.equal(await isProjectPeriodLocked(db, 'org', 'emp', null, '2026-11-02'), false);
  assert.equal(queries, 0);
  assert.equal(await isProjectPeriodLocked(db, 'org', 'emp', 'p1', '2026-11-02'), true);
});

test('project time is locked by its project month, not by the working-time timesheet', async () => {
  const make = (lockedTable: string) => {
    const db: any = {
      execute: async (q: unknown) => {
        const text = sqlText(q);
        if (text.includes('JOIN membership_roles')) return { rows: [{ name: 'member' }] };
        if (text.includes(lockedTable)) return { rows: [{ '?column?': 1 }] };
        return { rows: [] };
      },
      select: () => db, from: () => db, where: async () => [{ settings: {} }],
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'new' }] }) }),
    };
    const workTime = { checkProjectTime: async () => ({ ok: true }) } as unknown as WorkTimeModelService;
    return new ProjectTimeController({ getDb: () => db } as unknown as DbService, {} as ProjectTimeService, versions, workTime);
  };
  const body = { projectId: 'p1', startTime: '2026-11-02T08:00:00Z', endTime: '2026-11-02T10:00:00Z' };
  assert.deepEqual(await make('FROM project_time_periods').create('org', body, req), { ok: false, error: 'period-locked' });
  assert.deepEqual(await make('FROM timesheet_periods').create('org', body, req), { ok: true, id: 'new' });
});

/** Submit over a fake db: `totals` are the month's minutes per project, `existing` its project months. */
function submitSetup(totals: any[], existing: any[] = []) {
  const created: any[] = [];
  const updated: any[] = [];
  const db: any = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('JOIN membership_roles')) return { rows: [{ name: 'member' }] };
      if (text.includes('FROM project_times pt')) return { rows: totals };
      return { rows: [] };
    },
    select: () => ({ from: () => ({ where: async () => existing }) }),
    insert: () => ({ values: (v: any) => ({ returning: async () => { created.push(v); return [{ id: `period-${created.length}` }]; } }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { updated.push(v); } }) }),
  };
  const workflowsCreated: any[] = [];
  const workflowsSvc = {
    ensureDefinition: async () => ({ workflow_def_id: 'def' }),
    createWorkflow: async (_db: unknown, p: any) => { workflowsCreated.push(p); return { id: 'wf' }; },
  } as unknown as WorkflowsService;
  const controller = new ProjectTimesheetsController({ getDb: () => db } as unknown as DbService, audit, versions, workflowsSvc);
  return { controller, created, updated, workflowsCreated };
}

const row = (project_id: string | null, owner_user_id: string | null, minutes = 120) => ({
  project_id, project_name: project_id ? `Project ${project_id}` : null, owner_user_id, owner_name: null, minutes, entries: 2,
});

test('submit: hours without a project must be assigned first', async () => {
  const { controller } = submitSetup([row('p1', 'pm'), row(null, null)]);
  assert.deepEqual(await controller.submit('org', { periodStart: '2026-10-01' }, req), { ok: false, error: 'unassigned-entries', entries: 2 });
});

test('submit: validates the month and needs something left to submit', async () => {
  const { controller } = submitSetup([row('p1', 'pm')], [{ id: 'x', project_id: 'p1', status: 'approved' }]);
  assert.deepEqual(await controller.submit('org', { periodStart: '2026-10-15' }, req), { ok: false, error: 'invalid-period-start' });
  assert.deepEqual(await controller.submit('org', { periodStart: '2026-10-01' }, req), { ok: false, error: 'nothing-to-submit' });
});

test('submit: each project goes to its owner; own or ownerless projects are approved at once', async () => {
  const { controller, created, updated, workflowsCreated } = submitSetup(
    [row('p1', 'pm'), row('p2', 'emp'), row('p3', null), row('p4', 'pm')],
    [{ id: 'old-4', project_id: 'p4', status: 'rejected' }],
  );
  const res = await controller.submit('org', { periodStart: '2026-10-01', note: 'done' }, req);
  assert.deepEqual(res, {
    ok: true,
    projects: [
      { projectId: 'p1', projectName: 'Project p1', status: 'submitted' },
      { projectId: 'p2', projectName: 'Project p2', status: 'approved' },
      { projectId: 'p3', projectName: 'Project p3', status: 'approved' },
      { projectId: 'p4', projectName: 'Project p4', status: 'submitted' },
    ],
  });
  assert.equal(created.length, 3);
  assert.equal(created[0].period_end, '2026-11-01');
  assert.equal(updated[0].status, 'submitted'); // the rejected month, resubmitted
  assert.deepEqual(workflowsCreated.map((w) => [w.sourceTableUuid, w.assignedToUserId]), [['period-1', ['pm']], ['old-4', ['pm']]]);
});
