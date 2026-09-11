import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildInviteEmail } from './orgs.controller';
import {
  callerUserId,
  canManageRole,
  isAnyOrgAdmin,
  isOrgAdmin,
  isOrgMember,
  isPeriodLocked,
  pickPrimaryRole,
  type Executor,
} from './access';

function fakeDb(rows: Array<Record<string, unknown>>): Executor {
  return {
    execute: (async () => ({ rows })) as unknown as Executor['execute'],
  };
}

/** A fake whose `execute` returns a different canned result on each successive call, in order. */
function sequencedDb(responses: Array<Array<Record<string, unknown>>>): Executor {
  let call = 0;
  return {
    execute: (async () => ({ rows: responses[Math.min(call++, responses.length - 1)] ?? [] })) as unknown as Executor['execute'],
  };
}

test('invite email carries org, link and token', () => {
  const mail = buildInviteEmail('Acme Corp', 'tok-123');
  assert.match(mail.subject, /Acme Corp/);
  assert.match(mail.text, /Acme Corp/);
  assert.match(mail.text, /http:\/\/localhost:3001\/\?invite=tok-123/);
  assert.match(mail.text, /tok-123/);
});

test('callerUserId resolves local sub and keycloak identity', async () => {
  assert.equal(await callerUserId(fakeDb([]), { kind: 'local', sub: 'user-1' }), 'user-1');
  assert.equal(
    await callerUserId(fakeDb([{ user_id: 'user-2' }]), { kind: 'keycloak', sub: 'kc-sub' }),
    'user-2',
  );
  assert.equal(await callerUserId(fakeDb([]), { kind: 'keycloak', sub: 'unknown' }), null);
});

test('isOrgAdmin only allows active owner/admin', async () => {
  assert.equal(await isOrgAdmin(fakeDb([{ name: 'owner' }]), 'org', 'u'), true);
  assert.equal(await isOrgAdmin(fakeDb([{ name: 'admin' }]), 'org', 'u'), true);
  assert.equal(await isOrgAdmin(fakeDb([{ name: 'member' }]), 'org', 'u'), false);
  assert.equal(await isOrgAdmin(fakeDb([]), 'org', 'u'), false);
});

test('isAnyOrgAdmin spans organizations', async () => {
  assert.equal(await isAnyOrgAdmin(fakeDb([{ name: 'admin' }]), 'u'), true);
  assert.equal(await isAnyOrgAdmin(fakeDb([{ name: 'member' }]), 'u'), false);
  assert.equal(await isAnyOrgAdmin(fakeDb([]), 'u'), false);
});

test('isOrgMember is true for any active role, false with no membership at all', async () => {
  assert.equal(await isOrgMember(fakeDb([{ name: 'member' }]), 'org', 'u'), true);
  assert.equal(await isOrgMember(fakeDb([{ name: 'guest' }]), 'org', 'u'), true);
  assert.equal(await isOrgMember(fakeDb([{ name: 'admin' }]), 'org', 'u'), true);
  assert.equal(await isOrgMember(fakeDb([]), 'org', 'u'), false);
});

test('pickPrimaryRole collapses a multi-role set to the highest privilege one', () => {
  assert.equal(pickPrimaryRole(['member', 'admin']), 'admin');
  assert.equal(pickPrimaryRole(['manager', 'owner']), 'owner');
  assert.equal(pickPrimaryRole(['member', 'manager']), 'manager');
  assert.equal(pickPrimaryRole(['billing_admin']), 'billing_admin');
  assert.equal(pickPrimaryRole([]), null);
});

test('canManageRole: an org admin may manage any role, regardless of admin_user_ids', async () => {
  assert.equal(await canManageRole(fakeDb([{ name: 'admin' }]), 'org', 'u1', 'role-1'), true);
});

test('canManageRole: a non-admin is allowed only when listed in that role\'s admin_user_ids', async () => {
  const isRoleAdmin = sequencedDb([[{ name: 'member' }], [{ '?column?': 1 }]]);
  assert.equal(await canManageRole(isRoleAdmin, 'org', 'u1', 'role-1'), true);

  const isNotRoleAdmin = sequencedDb([[{ name: 'member' }], []]);
  assert.equal(await canManageRole(isNotRoleAdmin, 'org', 'u1', 'role-1'), false);
});

test('isPeriodLocked reflects whether a matching submitted/approved period row was found', async () => {
  assert.equal(await isPeriodLocked(fakeDb([{ '?column?': 1 }]), 'org', 'u', '2026-09-07'), true);
  assert.equal(await isPeriodLocked(fakeDb([]), 'org', 'u', '2026-09-07'), false);
});
