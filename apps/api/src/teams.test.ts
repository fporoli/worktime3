import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RbacService } from './rbac.service';
import { isOrgManagerOrAdmin, type Executor } from './access';

test('manager and admin have teams:manage permission, user does not', () => {
  const rbac = new RbacService();
  assert.equal(rbac.can('admin', 'teams:manage'), true);
  assert.equal(rbac.can('manager', 'teams:manage'), true);
  assert.equal(rbac.can('user', 'teams:manage'), false);
});

test('manager and admin have projects:manage permission, user does not', () => {
  const rbac = new RbacService();
  assert.equal(rbac.can('admin', 'projects:manage'), true);
  assert.equal(rbac.can('manager', 'projects:manage'), true);
  assert.equal(rbac.can('user', 'projects:manage'), false);
});

test('subproject creation rules: admin can always create, manager only if owner, user never', () => {
  const rbac = new RbacService();
  // Admin
  assert.equal(rbac.canCreateSubproject('admin', true), true);
  assert.equal(rbac.canCreateSubproject('admin', false), true);

  // Manager
  assert.equal(rbac.canCreateSubproject('manager', true), true);
  assert.equal(rbac.canCreateSubproject('manager', false), false);

  // User
  assert.equal(rbac.canCreateSubproject('user', true), false);
  assert.equal(rbac.canCreateSubproject('user', false), false);
});

test('isOrgManagerOrAdmin allows owner, admin, and manager, rejects member/guest', async () => {
  const fakeDb = (roleName: string | null): Executor => ({
    execute: (async () => ({
      rows: roleName ? [{ name: roleName }] : [],
    })) as unknown as Executor['execute'],
  });

  assert.equal(await isOrgManagerOrAdmin(fakeDb('owner'), 'org1', 'u1'), true);
  assert.equal(await isOrgManagerOrAdmin(fakeDb('admin'), 'org1', 'u1'), true);
  assert.equal(await isOrgManagerOrAdmin(fakeDb('manager'), 'org1', 'u1'), true);
  assert.equal(await isOrgManagerOrAdmin(fakeDb('member'), 'org1', 'u1'), false);
  assert.equal(await isOrgManagerOrAdmin(fakeDb('guest'), 'org1', 'u1'), false);
  assert.equal(await isOrgManagerOrAdmin(fakeDb(null), 'org1', 'u1'), false);
});

