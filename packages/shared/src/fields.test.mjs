import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY_TYPES, FORMS, WIDTHS, formFields, writableKeys } from './fields.ts';

const FIELD_TYPES = [...ENTRY_TYPES, 'select'];

for (const form of Object.values(FORMS)) {
  test(`${form.id}: field keys are unique`, () => {
    const keys = form.fields.map((f) => f.key);
    assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
  });

  test(`${form.id}: every field is in a declared group, with a unique order there`, () => {
    const groups = new Set(form.groups.map((g) => g.key));
    for (const f of form.fields) assert.ok(groups.has(f.group), `${f.key}: unknown group ${f.group}`);
    for (const g of form.groups) {
      const orders = formFields(form, g.key).map((f) => f.order);
      assert.equal(new Set(orders).size, orders.length, `${g.key}: duplicate order`);
    }
  });

  test(`${form.id}: types, widths and storage are valid`, () => {
    for (const f of form.fields) {
      assert.ok(FIELD_TYPES.includes(f.type), `${f.key}: type ${f.type}`);
      for (const t of f.allowedTypes ?? []) assert.ok(FIELD_TYPES.includes(t), `${f.key}: allowed type ${t}`);
      assert.ok(WIDTHS.includes(f.width), `${f.key}: width ${f.width}`);
      if (f.height !== undefined) assert.ok(f.height >= 1 && f.height <= 6, `${f.key}: height ${f.height}`);
      if (f.type === 'select') assert.ok(f.options, `${f.key}: select without options`);
      if (f.storage.kind === 'json') assert.ok(f.storage.key, `${f.key}: json storage without key`);
      assert.ok(f.caption, `${f.key}: no caption`);
    }
  });

  test(`${form.id}: no two fields write the same place`, () => {
    const places = form.fields
      .filter((f) => !f.readOnly)
      .map((f) => (f.storage.kind === 'json' ? `${f.storage.table}.${f.storage.column}.${f.storage.key}` : `${f.storage.table}.${f.storage.column}`));
    assert.deepEqual(places.filter((p, i) => places.indexOf(p) !== i), []);
  });
}

test('writableKeys leaves out read-only fields and keeps display order', () => {
  const keys = writableKeys(FORMS.basicdata, 'personalien');
  assert.ok(!keys.includes('companyEmail'));
  assert.equal(keys[0], 'displayName');
  assert.equal(keys.at(-1), 'residencePermitCode');
});
