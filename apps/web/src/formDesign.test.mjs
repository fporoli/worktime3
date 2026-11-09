import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASICDATA_FORM, EXPENSE_FORM, ENTRY_TYPES, GROUPS_KEY, VALIDATORS, WIDTHS, formFields, mergeForm } from '@worktime3/shared/fields';
import {
  addCustomField,
  changedKeys,
  checkLayers,
  configFor,
  designDef,
  emptyLayer,
  moveField,
  nudgeField,
  nudgeGroup,
  propertySource,
  setFieldProp,
  setFieldText,
  setGroupText,
  removeCustomField,
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
    ...['global', 'org'].map((s) => `design.addFieldScope.${s}`),
    ...['hr', 'self'].map((e) => `design.editableBy.${e}`),
    ...['group', 'newRow', 'width', 'height', 'type', 'required', 'hidden', 'validator', 'pattern', 'min', 'max', 'order', 'caption', 'tooltip', 'placeholder', 'patternMessage', 'editableBy', 'key'].map((p) => `design.prop.${p}`),
    ...[...reasons, 'forbidden', 'unknown-form', 'offline', 'unknown'].map((r) => `design.reason.${r}`),
    ...VALIDATORS.map((v) => `validation.${v}`),
  ];
  assert.ok(reasons.length >= 10, 'found the reason codes');
  const missing = [...new Set([...literal, ...dynamic])].filter((k) => !(k in DICTIONARIES.en));
  assert.deepEqual(missing, []);
});

test('custom fields: added at the end of a section, edited in their definition, removable until saved', () => {
  let org = addCustomField(form, emptyLayer(), 'placeOfBirth', 'text', 'personalien', 'Place of birth');
  assert.deepEqual(org.custom.placeOfBirth, { type: 'text', group: 'personalien', order: 140, caption: { en: 'Place of birth' } });
  org = setFieldText(setFieldProp(org, 'placeOfBirth', 'width', 'l'), 'placeOfBirth', 'caption', 'de', 'Geburtsort');
  assert.deepEqual(org.custom.placeOfBirth.caption, { en: 'Place of birth', de: 'Geburtsort' });
  assert.equal(org.custom.placeOfBirth.width, 'l');
  assert.deepEqual(org.fields, {}, 'a custom field is edited in its definition, not as an override');
  const merged = mergeForm(BASICDATA_FORM, undefined, org);
  assert.equal(keysOf(merged, 'personalien').at(-1), 'placeOfBirth');
  assert.deepEqual(changedKeys(emptyLayer(), org), ['placeOfBirth']);
  assert.deepEqual(configFor(org, 'placeOfBirth'), org.custom.placeOfBirth);
  assert.deepEqual(changedKeys(emptyLayer(), removeCustomField(org, 'placeOfBirth')), []);
});

test('checkLayers: custom keys must be free, captions present, saved types change only compatibly', () => {
  const saved = { global: emptyLayer(), org: emptyLayer() };
  const ok = { global: emptyLayer(), org: addCustomField(form, emptyLayer(), 'placeOfBirth', 'text', 'personalien', 'Place of birth') };
  assert.deepEqual(checkLayers(BASICDATA_FORM, saved, ok), []);
  const taken = { global: addCustomField(form, emptyLayer(), 'placeOfBirth', 'date', 'personalien', 'Born at'), org: ok.org };
  assert.deepEqual(checkLayers(BASICDATA_FORM, saved, taken).map((e) => `${e.scope}:${e.reason}`), ['global:key-taken', 'org:key-taken']);
  const noCaption = { global: emptyLayer(), org: setFieldText(ok.org, 'placeOfBirth', 'caption', 'en', '') };
  assert.deepEqual(checkLayers(BASICDATA_FORM, saved, noCaption).map((e) => e.reason), ['caption-missing']);
  const codeKey = { global: emptyLayer(), org: addCustomField(form, emptyLayer(), 'street', 'text', 'address', 'Street 2') };
  assert.deepEqual(checkLayers(BASICDATA_FORM, saved, codeKey).map((e) => e.reason), ['key-taken']);

  const savedCustom = { global: emptyLayer(), org: ok.org };
  const def = designDef(BASICDATA_FORM, savedCustom, savedCustom, 'org', 'placeOfBirth');
  assert.deepEqual(def.allowedTypes, [], 'a saved text field keeps its type');
  const toNumber = { global: emptyLayer(), org: setFieldProp(ok.org, 'placeOfBirth', 'type', 'number') };
  assert.deepEqual(checkLayers(BASICDATA_FORM, savedCustom, toNumber).map((e) => e.reason), ['type-not-allowed']);
  assert.deepEqual(designDef(BASICDATA_FORM, saved, ok, 'org', 'placeOfBirth').allowedTypes, [...ENTRY_TYPES], 'a new one may take any type');
});

test('designDef: in the org scope, a global custom field plays the code default', () => {
  const global = addCustomField(form, emptyLayer(), 'costCenter', 'text', 'expense', 'Cost centre');
  const layers = { global: setFieldProp(global, 'costCenter', 'required', true), org: emptyLayer() };
  const def = designDef(EXPENSE_FORM, layers, layers, 'org', 'costCenter');
  assert.equal(def.required, true);
  const loosened = { global: layers.global, org: setFieldProp(emptyLayer(), 'costCenter', 'required', false) };
  assert.deepEqual(checkLayers(EXPENSE_FORM, layers, loosened).map((e) => e.reason), ['loosens-code']);
});
