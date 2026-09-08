import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// RBAC matrix mirrored from src/rbac.service.ts (pure check, no Nest boot).
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['org:admin', 'members:manage', 'teams:manage', 'sso:configure', 'audit:read', 'data:read', 'data:write', 'projects:manage', 'worktime:approve'],
  manager: ['members:manage', 'teams:manage', 'data:read', 'data:write', 'projects:manage'],
  user: ['data:read', 'data:write'],
};
const can = (r: string, p: string) => (ROLE_PERMISSIONS[r] ?? []).includes(p);

test('admin can read audit + configure sso, user cannot', () => {
  assert.equal(can('admin', 'audit:read'), true);
  assert.equal(can('admin', 'sso:configure'), true);
  assert.equal(can('user', 'audit:read'), false);
  assert.equal(can('user', 'data:write'), true);
});

test('manager can invite/manage but cannot read audit', () => {
  assert.equal(can('manager', 'members:manage'), true);
  assert.equal(can('manager', 'audit:read'), false);
});
