import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RbacService } from '../../apps/api/src/rbac.service';

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
