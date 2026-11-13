import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EmploymentController, cleanText } from '../../apps/api/src/employment.controller';
import { membershipManagerId } from '../../apps/api/src/access';
import type { DbService } from '../../apps/api/src/db.service';
import type { AuditService } from '../../apps/api/src/audit.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { WorkflowsService } from '../../apps/api/src/workflows.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

// A person's employment is dated: each assignment names department, function and manager from
// its date on. HR (an edit grant on section.people.employment) maintains it; the manager may not
// be the person or someone below them on that date.

const ROLES: Record<string, { name: string; permission_id: string }[]> = {
  hr: [{ name: 'hr', permission_id: 'section.people.employment:edit:all' }, { name: 'hr', permission_id: 'nav.users:see:all' }],
  emp: [{ name: 'member', permission_id: 'section.people.employment:see:own' }],
  boss: [{ name: 'member', permission_id: 'section.people.employment:see:own' }],
  lead: [{ name: 'member', permission_id: 'section.people.employment:see:own' }],
};
// In force on any date: emp reports to boss, boss to lead.
const MANAGER: Record<string, string> = { emp: 'boss', boss: 'lead' };

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}
function sqlParams(query: any): any[] {
  return (query.queryChunks ?? []).filter((c: any) => !Array.isArray(c?.value));
}

function setup() {
  const inserts: any[] = [];
  let rerouted = 0;
  const db: any = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      const params = sqlParams(q);
      if (text.includes('LEFT JOIN role_permissions')) return { rows: ROLES[params[1]] ?? [] };
      if (text.includes('JOIN membership_roles')) return { rows: (ROLES[params[1]] ?? []).slice(0, 1) };
      if (text.includes('SELECT 1 FROM organization_memberships')) return { rows: ROLES[params[1]] ? [{ '?column?': 1 }] : [] };
      if (text.includes('SELECT manager_user_id FROM employee_assignments')) return { rows: MANAGER[params[1]] ? [{ manager_user_id: MANAGER[params[1]] }] : [] };
      return { rows: [] };
    },
    select: () => db,
    from: () => db,
    where: async () => [],
    insert: () => ({ values: (v: any) => { inserts.push(v); return { returning: async () => [{ id: 'new' }] }; } }),
  };
  const workflows = { rerouteToCurrentManagers: async () => { rerouted++; return 0; } } as unknown as WorkflowsService;
  const controller = new EmploymentController(
    { getDb: () => db } as unknown as DbService,
    { record: async () => {} } as unknown as AuditService,
    { record: async () => {} } as unknown as VersionsService,
    workflows,
  );
  return { db, controller, inserts, rerouted: () => rerouted };
}
const as = (sub: string) => ({ user: { kind: 'local', sub } }) as unknown as AuthenticatedRequest;

test('membershipManagerId asks for the assignment in force on a date', async () => {
  const { db } = setup();
  assert.equal(await membershipManagerId(db, 'org', 'emp'), 'boss');
  assert.equal(await membershipManagerId(db, 'org', 'lead', '2026-01-01'), null);
});

test('cleanText trims, empties to null and refuses over-long text', () => {
  assert.equal(cleanText('  Team Lead '), 'Team Lead');
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText(undefined), null);
  assert.equal(cleanText('x'.repeat(121)), undefined);
  assert.equal(cleanText(42), undefined);
});

test('HR records a dated manager change; requests then follow the manager', async () => {
  const s = setup();
  const result = await s.controller.addAssignment('org', 'emp', { validFrom: '2026-12-01', jobFunction: ' Developer ', managerUserId: 'lead' }, as('hr'));
  assert.deepEqual(result, { ok: true, id: 'new' });
  assert.deepEqual(s.inserts[0], { organization_id: 'org', user_id: 'emp', valid_from: '2026-12-01', department_id: null, job_function: 'Developer', manager_user_id: 'lead' });
  assert.equal(s.rerouted(), 1);
});

test('only an edit grant changes employment; not the person, not their manager', async () => {
  const body = { validFrom: '2026-12-01', managerUserId: 'lead' };
  assert.deepEqual(await setup().controller.addAssignment('org', 'emp', body, as('emp')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await setup().controller.addAssignment('org', 'emp', body, as('boss')), { ok: false, error: 'forbidden' });
});

test('the manager is someone else, not below the person, and the date is real', async () => {
  const { controller } = setup();
  assert.deepEqual(await controller.addAssignment('org', 'emp', { validFrom: '2026-12-01', managerUserId: 'emp' }, as('hr')), { ok: false, error: 'cannot-be-own-manager' });
  // lead's chain goes lead <- boss <- emp: emp may not manage lead.
  assert.deepEqual(await controller.addAssignment('org', 'lead', { validFrom: '2026-12-01', managerUserId: 'emp' }, as('hr')), { ok: false, error: 'manager-cycle' });
  assert.deepEqual(await controller.addAssignment('org', 'emp', { validFrom: '2026-02-30' }, as('hr')), { ok: false, error: 'invalid-date' });
  assert.deepEqual(await controller.addAssignment('org', 'emp', { validFrom: '2026-12-01', managerUserId: 'stranger' }, as('hr')), { ok: false, error: 'manager-not-a-member' });
});
