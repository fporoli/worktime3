import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ExpensesController } from '../../apps/api/src/expenses.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { DocumentsService } from '../../apps/api/src/documents.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';
import type { FieldsService } from '../../apps/api/src/fields.service';
import { EXPENSE_FORM, mergeForm, type FormLayer } from '@worktime3/shared/fields';
import { expenseColumns } from '../../apps/api/src/expenses.controller';

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
const mockDocumentsService = {} as unknown as DocumentsService;
const mockFields = (org?: FormLayer) => ({ resolved: async () => mergeForm(EXPENSE_FORM, undefined, org) }) as unknown as FieldsService;

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

  const controller = new ExpensesController(mockDb, mockVersionsService, mockDocumentsService, mockFields());
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

  const controller = new ExpensesController(mockDb, mockVersionsService, mockDocumentsService, mockFields());
  const req: AuthenticatedRequest = {
    user: { kind: 'local', sub: 'manager-1' },
  } as any;

  const result = await controller.list('org-1', req, 'report-user-2');
  assert.deepEqual(result, { entries: [] });
  assert.equal(executeCall, 3);
});

/** A member of org-1 whose inserts are captured. */
function createInsertDb() {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    execute: async () => ({ rows: [{ name: 'member' }] }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: async () => [{ id: 'expense-1' }] };
      },
    }),
  };
  return { inserted, service: { getDb: () => db as any } as unknown as DbService };
}

const memberReq = { user: { kind: 'local', sub: 'user-1' } } as unknown as AuthenticatedRequest;
const validBody = { expenseDate: '2026-11-02', category: 'travel', value: 42.5, currency: ' chf ', comment: '', projectId: '' };

test('expenseColumns maps registry keys to columns, numbers to strings and empty values to NULL', () => {
  assert.deepEqual(expenseColumns({ value: 12.5, currency: 'CHF', projectId: '', quantity: null }), {
    value: '12.5',
    currency: 'CHF',
    project_id: null,
    quantity: null,
  });
});

test('ExpensesController.create stores normalized values', async () => {
  const { inserted, service } = createInsertDb();
  const controller = new ExpensesController(service, mockVersionsService, mockDocumentsService, mockFields());
  const result = await controller.create('org-1', validBody as any, memberReq);
  assert.deepEqual(result, { ok: true, id: 'expense-1' });
  assert.equal(inserted[0].currency, 'CHF');
  assert.equal(inserted[0].value, '42.5');
  assert.equal(inserted[0].project_id, null);
  assert.equal(inserted[0].user_id, 'user-1');
});

test('ExpensesController.create refuses missing required fields and bad currencies', async () => {
  const { inserted, service } = createInsertDb();
  const controller = new ExpensesController(service, mockVersionsService, mockDocumentsService, mockFields());
  const result = await controller.create('org-1', { ...validBody, category: '', originalCurrency: 'EURO', originalValue: 0 } as any, memberReq);
  assert.deepEqual(result, {
    ok: false,
    error: 'invalid-field',
    fields: [
      { field: 'category', rule: 'required' },
      { field: 'originalValue', rule: 'min' },
      { field: 'originalCurrency', rule: 'currency' },
    ],
  });
  assert.equal(inserted.length, 0);
});

test('ExpensesController.create applies the org template (a project made required)', async () => {
  const { service } = createInsertDb();
  const controller = new ExpensesController(service, mockVersionsService, mockDocumentsService, mockFields({ fields: { projectId: { required: true } } }));
  const result = await controller.create('org-1', validBody as any, memberReq);
  assert.deepEqual(result, { ok: false, error: 'invalid-field', fields: [{ field: 'projectId', rule: 'required' }] });
});
