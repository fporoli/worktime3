import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ProjectTimeController } from '../../apps/api/src/project-time.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { ProjectTimeService } from '../../apps/api/src/project-time.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { WorkTimeModelService } from '../../apps/api/src/work-time-model.service';
import type { AuthenticatedRequest } from '../../apps/api/src/types';

function createMockDb(executeHandler: (query: unknown) => Promise<{ rows: any[] }>) {
  const db = {
    execute: executeHandler,
    select: () => db,
    from: () => db,
    leftJoin: () => db,
    where: () => db,
    orderBy: () => Promise.resolve([]),
  };
  return {
    getDb: () => db as any,
  } as unknown as DbService;
}

const mockProjectTimeService = {
  bucket: () => ({}),
} as unknown as ProjectTimeService;

const mockVersionsService = {
  record: async () => {},
} as unknown as VersionsService;

const mockWorkTime = {
  checkProjectTime: async () => ({ ok: true }),
} as unknown as WorkTimeModelService;

test('ProjectTimeController.list rejects non-admin/non-manager querying peer entries', async () => {
  let executeCall = 0;
  // Call 1: isOrgMember -> returns member role
  // Call 2: isOrgAdmin -> returns empty (not admin)
  // Call 3: isManagerOf (membershipManagerId) -> returns someone else as manager
  const mockDb = createMockDb(async () => {
    executeCall++;
    if (executeCall === 1) return { rows: [{ name: 'member' }] };
    if (executeCall === 2) return { rows: [] };
    if (executeCall === 3) return { rows: [{ manager_user_id: 'manager-99' }] };
    return { rows: [] };
  });

  const controller = new ProjectTimeController(mockDb, mockProjectTimeService, mockVersionsService, mockWorkTime);
  const req: AuthenticatedRequest = {
    user: { kind: 'local', sub: 'employee-1' },
  } as any;

  const result = await controller.list('org-1', req, 'peer-user-2');
  assert.deepEqual(result, { entries: [], summary: {} });
});

test('ProjectTimeController.list permits manager querying direct report entries', async () => {
  let executeCall = 0;
  // Call 1: isOrgMember -> returns manager role
  // Call 2: isOrgAdmin -> returns empty (not admin)
  // Call 3: isManagerOf (membershipManagerId) -> returns callerId ('manager-1')
  const mockDb = createMockDb(async () => {
    executeCall++;
    if (executeCall === 1) return { rows: [{ name: 'manager' }] };
    if (executeCall === 2) return { rows: [] };
    if (executeCall === 3) return { rows: [{ manager_user_id: 'manager-1' }] };
    return { rows: [] };
  });

  const controller = new ProjectTimeController(mockDb, mockProjectTimeService, mockVersionsService, mockWorkTime);
  const req: AuthenticatedRequest = {
    user: { kind: 'local', sub: 'manager-1' },
  } as any;

  const result = await controller.list('org-1', req, 'report-user-2');
  // Since manager check passed, it runs the query (which returns empty array from mock) and summary
  assert.deepEqual(result, { entries: [], summary: {} });
  assert.equal(executeCall, 3);
});

/** A db for create(): a member, nothing locked, no "ranges" preference; records inserts. */
function createDbForCreate() {
  const inserted: any[] = [];
  const db: any = {
    execute: async (q: any) => {
      const text = (q.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
      return text.includes('membership_roles') ? { rows: [{ name: 'member', permission_id: null }] } : { rows: [] };
    },
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ settings: {} }]) }) }),
    insert: () => ({ values: (v: any) => ({ returning: async () => { inserted.push(v); return [{ id: 'pt-1' }]; } }) }),
  };
  return { dbService: { getDb: () => db } as unknown as DbService, inserted };
}

test('ProjectTimeController.create warns about project time beyond the day\'s attendance, saves on confirmation', async () => {
  const { dbService, inserted } = createDbForCreate();
  const refusal = { ok: false, error: 'project-exceeds-attendance', date: '2026-11-10', projectMinutes: 600, attendanceMinutes: 240, toleranceMinutes: 15 };
  const calls: unknown[][] = [];
  const workTime = { checkProjectTime: async (...args: unknown[]) => { calls.push(args.slice(1)); return refusal; } } as unknown as WorkTimeModelService;
  const controller = new ProjectTimeController(dbService, mockProjectTimeService, mockVersionsService, workTime);
  const req = { user: { kind: 'local', sub: 'user-1' } } as any;
  const body = { startTime: '2026-11-10T07:00:00.000Z', endTime: '2026-11-10T17:00:00.000Z' };
  assert.deepEqual(await controller.create('org-1', body, req), { ...refusal, error: 'project-exceeds-attendance-confirm' });
  assert.deepEqual(calls, [['org-1', 'user-1', body.startTime, body.endTime]]);
  assert.equal(inserted.length, 0);
  // Confirmed: saved without checking again.
  assert.deepEqual(await controller.create('org-1', { ...body, acknowledgeAttendance: true }, req), { ok: true, id: 'pt-1' });
  assert.equal(calls.length, 1);
  assert.equal(inserted.length, 1);
});

test('ProjectTimeController.create saves when the check passes', async () => {
  const { dbService, inserted } = createDbForCreate();
  const controller = new ProjectTimeController(dbService, mockProjectTimeService, mockVersionsService, mockWorkTime);
  const req = { user: { kind: 'local', sub: 'user-1' } } as any;
  const result = await controller.create('org-1', { startTime: '2026-11-10T07:00:00.000Z', endTime: '2026-11-10T09:00:00.000Z' }, req);
  assert.deepEqual(result, { ok: true, id: 'pt-1' });
  assert.equal(inserted.length, 1);
});
