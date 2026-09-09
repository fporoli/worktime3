import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isAssignableInviteRole } from './roles.controller';

test('owner is reserved; every other system role is assignable via invite', () => {
  assert.equal(isAssignableInviteRole('owner'), false);
  assert.equal(isAssignableInviteRole('admin'), true);
  assert.equal(isAssignableInviteRole('manager'), true);
  assert.equal(isAssignableInviteRole('member'), true);
  assert.equal(isAssignableInviteRole('guest'), true);
  assert.equal(isAssignableInviteRole('billing_admin'), true);
});
