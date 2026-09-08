import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildInviteEmail } from './orgs.controller';
import { callerUserId, isOrgAdmin } from './access';

function fakePool(rows: Array<Record<string, unknown>>) {
  return {
    query: async () => ({ rows }),
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
  assert.equal(await callerUserId(fakePool([]), { kind: 'local', sub: 'user-1' }), 'user-1');
  assert.equal(
    await callerUserId(fakePool([{ user_id: 'user-2' }]), { kind: 'keycloak', sub: 'kc-sub' }),
    'user-2',
  );
  assert.equal(await callerUserId(fakePool([]), { kind: 'keycloak', sub: 'unknown' }), null);
});

test('isOrgAdmin only allows active owner/admin', async () => {
  assert.equal(await isOrgAdmin(fakePool([{ name: 'owner' }]), 'org', 'u'), true);
  assert.equal(await isOrgAdmin(fakePool([{ name: 'admin' }]), 'org', 'u'), true);
  assert.equal(await isOrgAdmin(fakePool([{ name: 'member' }]), 'org', 'u'), false);
  assert.equal(await isOrgAdmin(fakePool([]), 'org', 'u'), false);
});
