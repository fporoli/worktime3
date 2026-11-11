import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASICDATA_FORM } from './fields.ts';
import { NAV_OBJECTS, PERMISSION_OBJECTS, SECTION_OBJECTS, allPermissionIds, parsePermissionId } from './permissions.ts';

test('object ids are unique and well-formed', () => {
  const ids = PERMISSION_OBJECTS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of PERMISSION_OBJECTS) assert.match(o.id, o.kind === 'nav' ? /^nav\.\w+$/ : /^section\.\w+\.\w+$/);
});

test('every catalogue id parses and fits permissions.id (varchar 64)', () => {
  for (const id of allPermissionIds()) {
    assert.ok(parsePermissionId(id), id);
    assert.ok(id.length <= 64, id);
  }
});

test('basic-data sections match the form groups, and their parents are navbar entries', () => {
  const navIds = new Set(NAV_OBJECTS.map((o) => o.id));
  const groups = BASICDATA_FORM.groups.map((g) => `section.basicdata.${g.key}`);
  assert.deepEqual(SECTION_OBJECTS.map((o) => o.id).sort(), groups.sort());
  for (const o of SECTION_OBJECTS) assert.ok(o.id.startsWith('section.basicdata.'), o.id);
  for (const o of SECTION_OBJECTS) {
    assert.ok(navIds.has(o.parent.own) && navIds.has(o.parent.others), o.id);
  }
});
