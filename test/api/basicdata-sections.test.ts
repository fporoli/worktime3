import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isBasicDataReviewer, seesOthersBasicData } from '@worktime3/shared/permissions';
import { filterBasicDataBySections, sectionsOfPatch } from '../../apps/api/src/basicdata.controller';

const form = {
  fields: [
    { key: 'firstName', group: 'personalien' },
    { key: 'street', group: 'address' },
    { key: 'civilStatus', group: 'civilStatus' },
    { key: 'shoeSize', group: 'address' }, // an org's custom field
  ],
};

test('filterBasicDataBySections drops hidden sections, nested keys included', () => {
  const data = { firstName: 'Ueli', street: 'Main 1', bankAccounts: [{ iban: 'CH..' }], civilStatus: 'single', children: [], legacy: 1 };
  const onlyAddress = filterBasicDataBySections(data, form, (g) => g === 'address');
  assert.deepEqual(Object.keys(onlyAddress).sort(), ['bankAccounts', 'street']);
  // Keys of no section only for callers who see every section.
  assert.ok('legacy' in filterBasicDataBySections(data, form, () => true));
});

test('sectionsOfPatch maps keys (and org custom keys) to sections; unknown keys -> null', () => {
  assert.deepEqual([...sectionsOfPatch({ street: 'x', partner: {} }, form)!].sort(), ['address', 'civilStatus']);
  assert.deepEqual([...sectionsOfPatch({ orgs: { 'org-1': { shoeSize: 44 } } }, form)!], ['address']);
  assert.equal(sectionsOfPatch({ whatever: 1 }, form), null);
});

test('reviewers edit beyond their own data; seeing others is separate', () => {
  assert.equal(isBasicDataReviewer(['section.basicdata.address:edit:own']), false);
  assert.equal(isBasicDataReviewer(['section.basicdata.address:edit:team']), true);
  assert.equal(seesOthersBasicData(['section.basicdata.address:see:reports']), true);
  assert.equal(isBasicDataReviewer(['section.basicdata.address:see:reports']), false);
});
