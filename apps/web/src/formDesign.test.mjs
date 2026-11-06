import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASICDATA_FORM, ENTRY_TYPES, GROUPS_KEY, VALIDATORS, WIDTHS, formFields, mergeForm } from '@worktime3/shared/fields';
import {
  changedKeys,
  configFor,
  emptyLayer,
  moveField,
  nudgeField,
  nudgeGroup,
  propertySource,
  setFieldProp,
  setFieldText,
  setGroupText,
} from './formDesign.ts';
import { DICTIONARIES } from './dictionaries.ts';

const form = mergeForm(BASICDATA_FORM);
const keysOf = (f, group) => formFields(f, group).map((x) => x.key);

test('setFieldProp and setFieldText add and remove, dropping empty configs', () => {
  let layer = setFieldProp(emptyLayer(), 'street', 'width', 'l');
  assert.deepEqual(layer.fields.street, { width: 'l' });
  layer = setFieldText(layer, 'street', 'caption', 'de', 'Strasse');
  assert.deepEqual(layer.fields.street.caption, { de: 'Strasse' });
  layer = setFieldText(layer, 'street', 'caption', 'de', '');
  assert.equal(layer.fields.street.caption, undefined);
  layer = setFieldProp(layer, 'street', 'width', undefined);
  assert.equal('street' in layer.fields, false);
});

test('propertySource: org over global over code', () => {
  const layers = { global: setFieldProp(emptyLayer(), 'city', 'width', 'l'), org: setFieldProp(emptyLayer(), 'city', 'hidden', true) };
  assert.equal(propertySource(layers, 'city', 'width'), 'global');
  assert.equal(propertySource(layers, 'city', 'hidden'), 'org');
  assert.equal(propertySource(layers, 'city', 'order'), 'code');
});

test('moveField reorders within a group, writing only orders that change', () => {
  const layer = moveField(form, emptyLayer(), 'city', 'address', 'street');
  const moved = mergeForm(BASICDATA_FORM, layer);
  assert.deepEqual(keysOf(moved, 'address').slice(0, 4), ['salutation', 'city', 'street', 'postalCode']);
  assert.equal(layer.fields.salutation, undefined, 'salutation keeps order 10');
});

test('moveField moves a field into another group, at the end or before a field', () => {
  const end = mergeForm(BASICDATA_FORM, moveField(form, emptyLayer(), 'mobile', 'personalien', null));
  assert.equal(keysOf(end, 'personalien').at(-1), 'mobile');
  assert.ok(!keysOf(end, 'address').includes('mobile'));
  const before = mergeForm(BASICDATA_FORM, moveField(form, emptyLayer(), 'mobile', 'personalien', 'firstName'));
  assert.deepEqual(keysOf(before, 'personalien').slice(0, 3), ['displayName', 'mobile', 'firstName']);
});

test('nudgeField and nudgeGroup move one place and stop at the ends', () => {
  const down = mergeForm(BASICDATA_FORM, nudgeField(form, emptyLayer(), 'street', 1));
  assert.deepEqual(keysOf(down, 'address').slice(0, 3), ['salutation', 'postalCode', 'street']);
  assert.deepEqual(nudgeField(form, emptyLayer(), 'salutation', -1), emptyLayer());
  const groups = mergeForm(BASICDATA_FORM, nudgeGroup(form, emptyLayer(), 'civilStatus', -1));
  assert.deepEqual(groups.groups.map((g) => g.key), ['personalien', 'civilStatus', 'address']);
});

test('changedKeys finds changed fields and groups, ignoring key order', () => {
  const saved = { fields: { street: { width: 'l', order: 5 } }, groups: {} };
  assert.deepEqual(changedKeys(saved, { fields: { street: { order: 5, width: 'l' } }, groups: {} }), []);
  const draft = setGroupText(setFieldProp(saved, 'city', 'hidden', true), 'address', 'de', 'Wohnort');
  assert.deepEqual(changedKeys(saved, draft), ['city', GROUPS_KEY]);
  assert.deepEqual(configFor(draft, GROUPS_KEY), { address: { caption: { de: 'Wohnort' } } });
  assert.deepEqual(configFor(setFieldProp(saved, 'street', 'width', undefined), 'city'), {}, 'an empty config resets the field');
});

test('every text key the design panel builds exists in the dictionary', () => {
  const sources = ['FormDesigner.tsx', 'designMode.tsx', 'UserMenu.tsx'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const literal = [...sources.matchAll(/t\('(design\.[A-Za-z.:-]+)'/g)].map((m) => m[1]);
  const reasons = [...readFileSync(new URL('../../../packages/shared/src/fields.ts', import.meta.url), 'utf8').matchAll(/(?:reason: |fail\()'([a-z-]+)'/g)].map((m) => m[1]);
  const dynamic = [
    ...[...ENTRY_TYPES, 'select'].map((x) => `design.type.${x}`),
    ...VALIDATORS.map((v) => `design.validator.${v}`),
    ...WIDTHS.map((w) => `design.width.${w}`),
    ...['code', 'global', 'org'].map((s) => `design.source.${s}`),
    ...['global', 'org'].map((s) => `design.scope.${s}`),
    ...['group', 'newRow', 'width', 'height', 'type', 'required', 'hidden', 'validator', 'pattern', 'min', 'max', 'order', 'caption', 'tooltip', 'placeholder', 'patternMessage'].map((p) => `design.prop.${p}`),
    ...[...reasons, 'forbidden', 'unknown-form', 'offline', 'unknown'].map((r) => `design.reason.${r}`),
    ...VALIDATORS.map((v) => `validation.${v}`),
  ];
  assert.ok(reasons.length >= 10, 'found the reason codes');
  const missing = [...new Set([...literal, ...dynamic])].filter((k) => !(k in DICTIONARIES.en));
  assert.deepEqual(missing, []);
});
