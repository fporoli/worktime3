import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildInviteEmail } from './orgs.controller';
import { callerUserId, isAnyOrgAdmin, isOrgAdmin, isOrgMember, isPeriodLocked, type Executor } from './access';

function fakeDb(rows: Array<Record<string, unknown>>): Executor {
  return {
    execute: (async () => ({ rows })) as unknown as Executor['execute'],
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

test('isPeriodLocked reflects whether a matching submitted/approved period row was found', async () => {
  assert.equal(await isPeriodLocked(fakeDb([{ '?column?': 1 }]), 'org', 'u', '2026-09-07'), true);
  assert.equal(await isPeriodLocked(fakeDb([]), 'org', 'u', '2026-09-07'), false);
});
