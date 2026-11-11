import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isAssignableInviteRole } from '../../apps/api/src/roles.controller';

test('owner is reserved; every other system role is assignable via invite', () => {
  assert.equal(isAssignableInviteRole('owner'), false);
  assert.equal(isAssignableInviteRole('admin'), true);
  assert.equal(isAssignableInviteRole('manager'), true);
  assert.equal(isAssignableInviteRole('member'), true);
  assert.equal(isAssignableInviteRole('guest'), true);
  assert.equal(isAssignableInviteRole('billing_admin'), true);
});

import { checkAdminLock, checkPermissionIds, checkRoleName, effectiveOrgRoles, sanitizeTranslations } from '../../apps/api/src/roles.controller';

test('effectiveOrgRoles: an org copy replaces the global role; other orgs are ignored', () => {
  const rows = [
    { id: 'g-admin', organization_id: null, name: 'admin' },
    { id: 'g-manager', organization_id: null, name: 'manager' },
    { id: 'o-manager', organization_id: 'org-1', name: 'manager' },
    { id: 'o-lead', organization_id: 'org-1', name: 'Team lead' },
    { id: 'x-lead', organization_id: 'org-2', name: 'Other org role' },
  ];
  assert.deepEqual(
    effectiveOrgRoles(rows, 'org-1').map((r) => `${r.id}:${r.scope}`),
    ['g-admin:global', 'o-manager:override', 'o-lead:custom'],
  );
});

test('checkPermissionIds accepts catalogue ids only', () => {
  assert.equal(checkPermissionIds(['nav.time:edit:own', 'section.admin.roles:edit:all']), null);
  assert.equal(checkPermissionIds(['nav.time:edit:everyone']), 'unknown-permission');
  assert.equal(checkPermissionIds(['nav.admin:edit:own']), 'unknown-permission'); // org-wide page: only `all`
  assert.equal(checkPermissionIds('nav.time:edit:own'), 'invalid-permissions');
});

test('the admin role keeps role management', () => {
  assert.equal(checkAdminLock('admin', ['nav.admin:edit:all', 'section.admin.roles:edit:all']), null);
  assert.equal(checkAdminLock('admin', ['nav.admin:edit:all']), 'admin-role-locked');
  assert.equal(checkAdminLock('manager', []), null);
});

test('checkRoleName: required, at most 64 characters, unique ignoring case', () => {
  assert.equal(checkRoleName('Team lead', ['admin', 'manager']), null);
  assert.equal(checkRoleName('  ', []), 'name-required');
  assert.equal(checkRoleName('x'.repeat(65), []), 'name-too-long');
  assert.equal(checkRoleName('Manager', ['admin', 'manager']), 'name-taken');
});

test('sanitizeTranslations keeps non-empty strings', () => {
  assert.deepEqual(sanitizeTranslations({ de: ' Teamleitung ', fr: '', it: 3 }), { de: 'Teamleitung' });
  assert.deepEqual(sanitizeTranslations(['de']), {});
});
