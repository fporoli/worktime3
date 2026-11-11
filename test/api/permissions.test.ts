import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  PERMISSION_OBJECTS,
  allPermissionIds,
  grantedScopes,
  holdsAny,
  parsePermissionId,
  scopesCover,
  sectionParent,
} from '@worktime3/shared/permissions';
import { can, mergePermissionRows, visibleUserIds, type Executor } from '../../apps/api/src/access';
import { isRoleAssignableInOrg } from '../../apps/api/src/orgs.controller';

const ORG = 'org-1';
const ME = 'user-me';
const OTHER = 'user-other';

/** Answers every query as "yes": the target is a member, a report, a teammate. */
const yesDb: Executor = { execute: async () => ({ rows: [{ ok: 1, manager_user_id: ME, user_id: OTHER }] }) } as unknown as Executor;
/** Fails the test if a query runs. */
const noQueryDb: Executor = {
  execute: async () => {
    throw new Error('unexpected query');
  },
} as unknown as Executor;

test('parsePermissionId accepts <object>:<action>:<scope> only', () => {
  assert.deepEqual(parsePermissionId('nav.teamHours:see:reports'), { object: 'nav.teamHours', action: 'see', scope: 'reports' });
  assert.equal(parsePermissionId('data:read'), null);
  assert.equal(parsePermissionId('nav.users:delete:all'), null);
  assert.equal(parsePermissionId('nav.users:see:world'), null);
});

test('edit grants count for see, not the other way round', () => {
  const held = ['nav.users:edit:team', 'nav.users:see:all', 'nav.time:see:own'];
  assert.deepEqual([...grantedScopes(held, 'nav.users', 'see')].sort(), ['all', 'team']);
  assert.deepEqual([...grantedScopes(held, 'nav.users', 'edit')], ['team']);
  assert.deepEqual([...grantedScopes(held, 'nav.time', 'edit')], []);
  assert.equal(holdsAny(held, 'nav.time'), true);
  assert.equal(holdsAny(held, 'nav.admin'), false);
});

test('scopesCover matches each scope to its relation', () => {
  const none = { isSelf: false, isTeammate: false, isReport: false, isMember: false };
  assert.equal(scopesCover(['own'], { ...none, isSelf: true }), true);
  assert.equal(scopesCover(['own'], { ...none, isMember: true }), false);
  assert.equal(scopesCover(['team'], { ...none, isTeammate: true }), true);
  assert.equal(scopesCover(['reports'], { ...none, isTeammate: true }), false);
  assert.equal(scopesCover(['reports'], { ...none, isReport: true }), true);
  assert.equal(scopesCover(['all'], { ...none, isMember: true }), true);
  assert.equal(scopesCover(['all'], none), false);
});

test('owner holds the whole catalogue; other roles exactly their rows', () => {
  assert.equal(mergePermissionRows([{ name: 'owner', permission_id: null }]).size, allPermissionIds().length);
  const merged = mergePermissionRows([
    { name: 'member', permission_id: 'nav.time:edit:own' },
    { name: 'hr', permission_id: 'nav.users:edit:all' },
    { name: 'guest', permission_id: null },
  ]);
  assert.deepEqual([...merged].sort(), ['nav.time:edit:own', 'nav.users:edit:all']);
});

test('sections hang off My data for own data and Users for everyone else', () => {
  assert.equal(sectionParent('section.basicdata.address', true), 'nav.myData');
  assert.equal(sectionParent('section.basicdata.address', false), 'nav.users');
  assert.equal(sectionParent('nav.users', false), null);
});

test('can(): a section needs its parent navbar entry', async () => {
  const hrWithoutUsers = new Set(['section.basicdata.personalien:edit:all', 'nav.myData:edit:own']);
  assert.equal(await can(noQueryDb, ORG, ME, 'section.basicdata.personalien', 'edit', OTHER, hrWithoutUsers), false);
  const hr = new Set([...hrWithoutUsers, 'nav.users:see:all']);
  assert.equal(await can(yesDb, ORG, ME, 'section.basicdata.personalien', 'edit', OTHER, hr), true);
  // Own data goes through My data: without it, even an `all` grant does not reach the caller's own section.
  const noMyData = new Set(['section.basicdata.address:edit:all', 'nav.users:see:all']);
  assert.equal(await can(yesDb, ORG, ME, 'section.basicdata.address', 'edit', ME, noMyData), false);
});

test('can(): own scope needs no query, see does not imply edit', async () => {
  const member = new Set(['nav.myData:edit:own', 'section.basicdata.personalien:see:own']);
  assert.equal(await can(noQueryDb, ORG, ME, 'section.basicdata.personalien', 'see', ME, member), true);
  assert.equal(await can(noQueryDb, ORG, ME, 'section.basicdata.personalien', 'edit', ME, member), false);
  assert.equal(await can(noQueryDb, ORG, ME, 'nav.myData', 'see', undefined, member), true);
  assert.equal(await can(noQueryDb, ORG, ME, 'nav.users', 'see', undefined, member), false);
});

test('visibleUserIds(): own-only grant is just the caller; all is all', async () => {
  const own = await visibleUserIds(noQueryDb, ORG, ME, 'nav.time', 'see', new Set(['nav.time:edit:own']));
  assert.deepEqual(own instanceof Set ? [...own] : own, [ME]);
  assert.equal(await visibleUserIds(noQueryDb, ORG, ME, 'nav.teamHours', 'see', new Set(['nav.teamHours:see:all'])), 'all');
});

test('roles are assignable when global (without an org copy) or owned by the same org', () => {
  assert.equal(isRoleAssignableInOrg({ organization_id: null }, ORG, false), true);
  assert.equal(isRoleAssignableInOrg({ organization_id: null }, ORG, true), false);
  assert.equal(isRoleAssignableInOrg({ organization_id: ORG }, ORG, false), true);
  assert.equal(isRoleAssignableInOrg({ organization_id: 'org-2' }, ORG, false), false);
});

test('the migration catalogue matches the shared registry, and default grants use catalogue ids', () => {
  const dir = join(__dirname, '../../infra/liquibase/changelog');
  const files = readdirSync(dir).filter((f) => /^\d{3}-permission-.*\.sql$/.test(f)).sort();
  const sql = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  // 035 lists objects with their kind (people: own/team/reports/all; org: all) and cross-joins them.
  const ids = new Set<string>();
  for (const m of sql.matchAll(/\('((?:nav|section)\.[\w.]+)', '(people|org)'\)/g)) {
    for (const action of ['see', 'edit']) {
      for (const scope of m[2] === 'people' ? ['own', 'team', 'reports', 'all'] : ['all']) ids.add(`${m[1]}:${action}:${scope}`);
    }
  }
  // Later changelogs insert permission ids directly: `('<id>', '<description>')`.
  for (const m of sql.matchAll(/\('((?:nav|section)\.[\w.]+:\w+:\w+)', '[^']*'\)/g)) ids.add(m[1]);
  assert.deepEqual([...ids].sort(), allPermissionIds().sort());

  const catalogue = new Set(allPermissionIds());
  const granted = [...sql.matchAll(/'((?:nav|section)\.[\w.]+:\w+:\w+)'/g)].map((m) => m[1]);
  assert.ok(granted.length > 0);
  for (const id of granted) assert.ok(catalogue.has(id), `${id} is not in the catalogue`);
});
