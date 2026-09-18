import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AbsencesController } from '../../apps/api/src/absences.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { AuditService } from '../../apps/api/src/audit.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { WorkflowsService } from '../../apps/api/src/workflows.service';
import type { BalancesService } from '../../apps/api/src/balances.service';
import type { DocumentsService } from '../../apps/api/src/documents.service';
import type { AuthenticatedRequest } from '../../apps/api/src/types';

/**
 * `chainRows[n]` is the row set returned by the (n+1)th `db.select(...)...` call that resolves
 * without an explicit `.orderBy()` (e.g. `resolveAbsenceTypes`'s `static_data` lookup) — `[]` by
 * default (no org override, so callers fall back to the built-in absence types).
 */
function createMockDb(executeHandler: (query: unknown) => Promise<{ rows: any[] }>, chainRows: any[][] = []) {
  let chainCallIndex = 0;
  function makeChain() {
    const rows = chainRows[chainCallIndex] ?? [];
    chainCallIndex++;
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(rows),
      // Makes the chain itself awaitable when a caller doesn't chain `.orderBy()`.
      then: (resolve: (v: any) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }
  const db = {
    execute: executeHandler,
    select: () => makeChain(),
  };
  return {
    getDb: () => db as any,
  } as unknown as DbService;
}

const mockAudit = {} as unknown as AuditService;
const mockVersions = { record: async () => {} } as unknown as VersionsService;
const mockWorkflows = {} as unknown as WorkflowsService;
const mockBalances = {} as unknown as BalancesService;
const mockDocuments = {} as unknown as DocumentsService;

function makeController(mockDb: DbService) {
  return new AbsencesController(mockDb, mockAudit, mockVersions, mockWorkflows, mockBalances, mockDocuments);
}

test('AbsencesController.list rejects non-admin/non-manager querying peer entries', async () => {
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

  const controller = makeController(mockDb);
  const req: AuthenticatedRequest = { user: { kind: 'local', sub: 'employee-1' } } as any;

  const result = await controller.list('org-1', req, 'peer-user-2');
  assert.deepEqual(result, []);
});

test('AbsencesController.list permits manager querying direct report entries', async () => {
  let executeCall = 0;
  const mockDb = createMockDb(async () => {
    executeCall++;
    if (executeCall === 1) return { rows: [{ name: 'manager' }] };
    if (executeCall === 2) return { rows: [] };
    if (executeCall === 3) return { rows: [{ manager_user_id: 'manager-1' }] };
    return { rows: [] };
  });

  const controller = makeController(mockDb);
  const req: AuthenticatedRequest = { user: { kind: 'local', sub: 'manager-1' } } as any;

  const result = await controller.list('org-1', req, 'report-user-2');
  assert.deepEqual(result, []);
  assert.equal(executeCall, 3);
});

test('AbsencesController.list permits an org admin querying anyone', async () => {
  let executeCall = 0;
  // Call 1: isOrgMember -> admin role. Call 2: isOrgAdmin -> admin role present.
  const mockDb = createMockDb(async () => {
    executeCall++;
    return { rows: [{ name: 'admin' }] };
  });

  const controller = makeController(mockDb);
  const req: AuthenticatedRequest = { user: { kind: 'local', sub: 'admin-1' } } as any;

  const result = await controller.list('org-1', req, 'anyone-else');
  assert.deepEqual(result, []);
  assert.equal(executeCall, 2);
});

test('AbsencesController.submit rejects half-day on a multi-day range', async () => {
  // Call 1: isOrgMember -> returns a role, so the caller is a member.
  const mockDb = createMockDb(async () => ({ rows: [{ name: 'member' }] }));
  const controller = makeController(mockDb);
  const req: AuthenticatedRequest = { user: { kind: 'local', sub: 'employee-1' } } as any;

  const result = await controller.submit('org-1', { dateStart: '2026-09-07', dateEnd: '2026-09-11', halfDay: true }, req);
  assert.deepEqual(result, { ok: false, error: 'half-day-requires-single-day' });
});

test('AbsencesController.submit rejects an absence type the org does not recognize', async () => {
  const mockDb = createMockDb(
    async () => ({ rows: [{ name: 'member' }] }),
    [[]], // resolveAbsenceTypes: no static_data override -> falls back to the built-in defaults
  );
  const controller = makeController(mockDb);
  const req: AuthenticatedRequest = { user: { kind: 'local', sub: 'employee-1' } } as any;

  const result = await controller.submit('org-1', { dateStart: '2026-09-07', dateEnd: '2026-09-07', absenceType: 'not-a-real-type' }, req);
  assert.deepEqual(result, { ok: false, error: 'invalid-absence-type' });
});
