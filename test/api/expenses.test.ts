import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ExpensesController } from '../../apps/api/src/expenses.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
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

const mockVersionsService = {
  record: async () => {},
} as unknown as VersionsService;

test('ExpensesController.list rejects non-admin/non-manager querying peer entries', async () => {
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

  const controller = new ExpensesController(mockDb, mockVersionsService);
  const req: AuthenticatedRequest = {
    user: { kind: 'local', sub: 'employee-1' },
  } as any;

  const result = await controller.list('org-1', req, 'peer-user-2');
  assert.deepEqual(result, { entries: [] });
});

test('ExpensesController.list permits manager querying direct report entries', async () => {
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

  const controller = new ExpensesController(mockDb, mockVersionsService);
  const req: AuthenticatedRequest = {
    user: { kind: 'local', sub: 'manager-1' },
  } as any;

  const result = await controller.list('org-1', req, 'report-user-2');
  assert.deepEqual(result, { entries: [] });
  assert.equal(executeCall, 3);
});
