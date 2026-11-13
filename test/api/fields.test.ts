import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  BASICDATA_FORM,
  applyValidator,
  checkFieldOverride,
  checkGroupsOverride,
  mergeForm,
  resolveText,
  validateFields,
  EXPENSE_FORM,
  checkCustomField,
  checkCustomKey,
  editableKeys,
  orgCustomKeys,
} from '@worktime3/shared/fields';
import { FieldsController } from '../../apps/api/src/fields.controller';
import { FieldsService } from '../../apps/api/src/fields.service';
import { BASICDATA_HR_KEYS, BASICDATA_SELF_KEYS, BASICDATA_USER_COLUMNS, allowedKeys } from '../../apps/api/src/basicdata.controller';
import { keepOrgSection, nestOrgKeys, scopeToOrg } from '../../apps/api/src/basicdata.service';
import type { DbService } from '../../apps/api/src/db.service';
import type { AuditService } from '../../apps/api/src/audit.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

// ---------------------------------------------------------------------------
// Merging layers
// ---------------------------------------------------------------------------

test('mergeForm: org beats global beats code; texts merge per language', () => {
  const form = mergeForm(
    BASICDATA_FORM,
    { fields: { street: { caption: { en: 'Street (global)', de: 'Strasse (global)' }, width: 'l' } } },
    { fields: { street: { caption: { de: 'Strasse und Nr.' }, order: 5 } }, groups: { address: { order: 1, caption: { en: 'Where you live' } } } },
  );
  const street = form.fields.find((f) => f.key === 'street')!;
  assert.deepEqual(street.texts.caption, { en: 'Street (global)', de: 'Strasse und Nr.' });
  assert.equal(street.width, 'l');
  assert.equal(street.order, 5);
  assert.equal(street.caption, 'home.field.street', 'the i18n key stays as fallback');
  assert.equal(form.groups[0].key, 'address', 'groups sorted by the overridden order');
  assert.deepEqual(form.groups[0].texts.caption, { en: 'Where you live' });
});

test('mergeForm with no layers equals the code defaults', () => {
  const form = mergeForm(BASICDATA_FORM);
  assert.equal(form.fields.length, BASICDATA_FORM.fields.length);
  assert.ok(form.fields.every((f) => Object.keys(f.texts).length === 0));
});

test('resolveText: template text in the language, else the dictionary, else English template text', () => {
  const t = (key: string) => `dict:${key}`;
  assert.equal(resolveText({ de: 'Geburtsort' }, 'home.field.x', 'de', t), 'Geburtsort');
  assert.equal(resolveText({ de: 'Geburtsort' }, 'home.field.x', 'fr', t), 'dict:home.field.x');
  assert.equal(resolveText({ en: 'Place of birth' }, undefined, 'fr', t), 'Place of birth');
});

// ---------------------------------------------------------------------------
// Checking overrides against the code registry
// ---------------------------------------------------------------------------

function reason(fieldKey: string, config: unknown) {
  const r = checkFieldOverride(BASICDATA_FORM, fieldKey, config);
  return r.ok ? 'ok' : r.reason;
}

test('checkFieldOverride accepts layout and text changes', () => {
  assert.equal(reason('street', { caption: { en: 'Street', de: 'Strasse' }, width: 'full', order: 3, newRow: true, group: 'personalien' }), 'ok');
  assert.equal(reason('street', { height: 3 }), 'ok');
  assert.equal(reason('middleName', { hidden: true }), 'ok');
  assert.equal(reason('street', { required: true, pattern: '[A-Za-zäöü ]+ \\d+', patternMessage: { en: 'Street and number' } }), 'ok');
});

test('checkFieldOverride drops empty texts', () => {
  const r = checkFieldOverride(BASICDATA_FORM, 'street', { caption: { en: 'Street', de: '' } });
  assert.ok(r.ok);
  assert.deepEqual(r.value.caption, { en: 'Street' });
});

test('checkFieldOverride rejects what the code does not allow', () => {
  assert.equal(reason('nope', {}), 'unknown-field');
  assert.equal(reason('street', []), 'not-an-object');
  assert.equal(reason('street', { colour: 'red' }), 'unknown-property');
  assert.equal(reason('street', { editableBy: 'self' }), 'unknown-property', 'editableBy of a built-in field is fixed');
  assert.equal(reason('street', { group: 'elsewhere' }), 'unknown-group');
  assert.equal(reason('street', { width: 'xl' }), 'invalid-value');
  assert.equal(reason('street', { height: 9 }), 'invalid-value');
  assert.equal(reason('street', { caption: { 'not a lang': 'x' } }), 'invalid-value');
});

test('checkFieldOverride: stricter only', () => {
  assert.equal(reason('displayName', { required: false }), 'loosens-code');
  assert.equal(reason('displayName', { required: true }), 'ok');
  assert.equal(reason('displayName', { hidden: true }), 'not-hideable');
  assert.equal(reason('companyEmail', { required: true }), 'read-only');
});

test('checkFieldOverride: entry type changes', () => {
  assert.equal(reason('birthDate', { type: 'date' }), 'ok');
  assert.equal(reason('birthDate', { type: 'text' }), 'type-not-allowed');
  assert.equal(reason('street', { type: 'number' }), 'type-not-allowed');
  assert.equal(reason('nationality', { type: 'text' }), 'type-not-allowed');
  assert.equal(reason('birthDate', { height: 2 }), 'height-needs-text');
});

test('checkFieldOverride: patterns and bounds', () => {
  assert.equal(reason('street', { pattern: '(' }), 'bad-pattern');
  assert.equal(reason('street', { pattern: 'x'.repeat(201) }), 'bad-pattern');
  assert.equal(reason('street', { pattern: '\\d+' }), 'pattern-message-missing');
  assert.equal(reason('birthDate', { min: '1900-01-01', max: '2020-12-31' }), 'ok');
  assert.equal(reason('birthDate', { min: '2020-01-01', max: '1900-12-31' }), 'min-above-max');
  assert.equal(reason('birthDate', { min: 5 }), 'invalid-value');
  assert.equal(reason('street', { min: 1 }), 'invalid-value', 'bounds only for numbers and dates');
  assert.equal(reason('street', { validator: 'unknown' }), 'invalid-value');
  assert.equal(reason('email', { validator: 'email' }), 'ok');
});

test('checkGroupsOverride', () => {
  assert.ok(checkGroupsOverride(BASICDATA_FORM, { address: { caption: { de: 'Wohnadresse' }, order: 5 } }).ok);
  const bad = checkGroupsOverride(BASICDATA_FORM, { nowhere: { order: 1 } });
  assert.ok(!bad.ok && bad.reason === 'unknown-group');
  const badProp = checkGroupsOverride(BASICDATA_FORM, { address: { width: 'l' } });
  assert.ok(!badProp.ok && badProp.reason === 'unknown-property');
});

// ---------------------------------------------------------------------------
// Validators and value validation
// ---------------------------------------------------------------------------

test('named validators check and normalize', () => {
  assert.equal(applyValidator('email', ' Anna.Muster@Example.CH '), 'Anna.Muster@example.ch');
  assert.equal(applyValidator('email', 'anna@'), null);
  assert.equal(applyValidator('phone', '+41 44 123 45 67'), '+41441234567');
  assert.equal(applyValidator('phone', '044/123 45 67'), '0441234567');
  assert.equal(applyValidator('phone', 'call me'), null);
  assert.equal(applyValidator('iban', 'ch93 0076 2011 6238 5295 7'), 'CH9300762011623852957');
  assert.equal(applyValidator('iban', 'CH9300762011623852958'), null);
  assert.equal(applyValidator('postcode:CH', ' 8001 '), '8001');
  assert.equal(applyValidator('postcode:CH', '0800'), null);
  assert.equal(applyValidator('ahv', '7569217076985'), '756.9217.0769.85');
  assert.equal(applyValidator('ahv', '756.9217.0769.86'), null);
  assert.equal(applyValidator('currency', ' chf '), 'CHF');
  assert.equal(applyValidator('currency', 'EURO'), null);
});

test('validateFields: required, types, bounds, validators, patterns', () => {
  const form = mergeForm(BASICDATA_FORM, {
    fields: {
      street: { required: true, pattern: '.+ \\d+', patternMessage: { en: 'Street and number' } },
      email: { validator: 'email' },
      birthDate: { min: '1900-01-01' },
      middleName: { hidden: true, required: true },
    },
  });
  const r = validateFields(form, {
    displayName: '',
    street: 'Bahnhofstrasse',
    email: 'A@B.CH',
    birthDate: '1850-01-01',
    middleName: '',
    bankAccounts: [{ bank: 'X', iban: '' }],
  });
  assert.deepEqual(r.errors, [
    { field: 'displayName', rule: 'required' },
    { field: 'birthDate', rule: 'min' },
    { field: 'street', rule: 'pattern' },
  ]);
  assert.equal(r.values.email, 'A@b.ch');
  assert.deepEqual(r.values.bankAccounts, [{ bank: 'X', iban: '' }], 'keys outside the registry pass through');

  const types = validateFields(mergeForm(BASICDATA_FORM), { birthDate: '1.3.2026', street: 42 });
  assert.deepEqual(types.errors, [
    { field: 'birthDate', rule: 'type' },
    { field: 'street', rule: 'type' },
  ]);
  assert.deepEqual(validateFields(mergeForm(BASICDATA_FORM), { street: 'Bahnhofstrasse 1' }).errors, [], 'fields not in the patch are not checked');
});

// ---------------------------------------------------------------------------
// Basic data keys now come from the registry
// ---------------------------------------------------------------------------

test('basic data: employees request changes to every section; only the personnel number is HR-only', () => {
  const adminOnly = ['personnelNumber'];
  const selfService = ['gender', 'birthDate', 'socialSecurityNumber', 'languageCode', 'placeOfOrigin', 'nationality', 'residencePermitCode', 'displayName', 'firstName', 'middleName', 'lastName', 'salutation', 'street', 'postalCode', 'city', 'country', 'canton', 'phone1', 'phone2', 'mobile', 'email', 'bankAccounts', 'emergencyContacts', 'civilStatus', 'civilStatusSince', 'partner', 'children'];
  assert.deepEqual([...BASICDATA_SELF_KEYS].sort(), [...selfService].sort());
  assert.deepEqual([...BASICDATA_HR_KEYS].sort(), [...adminOnly, ...selfService].sort());
  assert.deepEqual(BASICDATA_USER_COLUMNS, { displayName: 'display_name', firstName: 'first_name', middleName: 'middle_name', lastName: 'last_name' });
});

// ---------------------------------------------------------------------------
// FieldsController authorization and checks
// ---------------------------------------------------------------------------

/** The SQL text of a drizzle `sql` template, without parameters. */
function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

function setup(opts: { roles?: string[]; superdeveloper?: boolean; rows?: any[]; orgCustomKeyTaken?: boolean }) {
  const writes: string[] = [];
  const stored: any[] = [];
  const db = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('FROM user_identities')) return { rows: [{ user_id: 'caller-1' }] };
      if (text.includes('JOIN membership_roles')) return { rows: (opts.roles ?? []).map((name) => ({ name })) };
      if (text.includes('is_superdeveloper')) return { rows: [{ is_superdeveloper: !!opts.superdeveloper }] };
      if (text.includes('SELECT organization_id, field_key, is_custom, config FROM field_config')) return { rows: opts.rows ?? [] };
      if (text.includes('SELECT 1 FROM field_config')) return { rows: opts.orgCustomKeyTaken ? [{ '?column?': 1 }] : [] };
      if (text.includes('INSERT INTO field_config')) {
        writes.push('insert');
        stored.push((q as any).queryChunks.filter((c: any) => !(Array.isArray(c?.value))));
        return { rows: [{ id: 'cfg-1' }] };
      }
      if (text.includes('DELETE FROM field_config')) {
        writes.push('delete');
        return { rows: [{ id: 'cfg-1' }] };
      }
      return { rows: [] };
    },
  };
  const dbService = { getDb: () => db } as unknown as DbService;
  const fields = new FieldsService(dbService);
  const audit = { record: async () => {} } as unknown as AuditService;
  const versions = { record: async () => {} } as unknown as VersionsService;
  const controller = new FieldsController(dbService, fields, audit, versions);
  const req = { user: { kind: 'local', sub: 'caller-1' } } as unknown as AuthenticatedRequest;
  return { controller, fields, req, writes, stored };
}

test('FieldsController.get: members get the merged template, others nothing', async () => {
  const member = setup({ roles: ['member'], rows: [{ organization_id: 'org-1', field_key: 'middleName', config: { hidden: true } }] });
  const res: any = await member.controller.get('org-1', 'basicdata', member.req);
  assert.equal(res.ok, true);
  assert.equal(res.form.fields.find((f: any) => f.key === 'middleName').hidden, true);

  const outsider = setup({ roles: [] });
  assert.deepEqual(await outsider.controller.get('org-1', 'basicdata', outsider.req), { ok: false, error: 'forbidden' });
  assert.deepEqual(await outsider.controller.get('org-1', 'nope', outsider.req), { ok: false, error: 'unknown-form' });
});

test('FieldsController: only developers edit the org layer, only superdevelopers the global one', async () => {
  const admin = setup({ roles: ['admin'] });
  assert.deepEqual(await admin.controller.putOrg('org-1', 'basicdata', 'middleName', { config: { hidden: true } }, admin.req), { ok: false, error: 'forbidden' });
  assert.deepEqual(admin.writes, []);

  const dev = setup({ roles: ['member', 'developer'] });
  assert.deepEqual(await dev.controller.putOrg('org-1', 'basicdata', 'middleName', { config: { hidden: true } }, dev.req), { ok: true, config: { hidden: true } });
  assert.deepEqual(await dev.controller.putGlobal('basicdata', 'middleName', { config: { hidden: true } }, dev.req), { ok: false, error: 'forbidden' });
  assert.deepEqual(dev.writes, ['insert']);

  const superDev = setup({ roles: [], superdeveloper: true });
  assert.equal(((await superDev.controller.putGlobal('basicdata', 'street', { config: { width: 'l' } }, superDev.req)) as any).ok, true);
  assert.equal(((await superDev.controller.putOrg('org-9', 'basicdata', 'street', { config: { width: 'l' } }, superDev.req)) as any).ok, true, 'a superdeveloper may edit any org');
});

test('FieldsController: invalid configs are refused, empty ones reset the field', async () => {
  const dev = setup({ roles: ['developer'] });
  assert.deepEqual(await dev.controller.putOrg('org-1', 'basicdata', 'displayName', { config: { hidden: true } }, dev.req), {
    ok: false,
    error: 'field-config-invalid',
    reason: 'not-hideable',
    property: 'hidden',
  });
  assert.deepEqual(dev.writes, []);
  assert.deepEqual(await dev.controller.putOrg('org-1', 'basicdata', 'street', { config: {} }, dev.req), { ok: true });
  assert.deepEqual(dev.writes, ['delete']);
  assert.equal(((await dev.controller.putOrg('org-1', 'basicdata', '$groups', { config: { address: { order: 1 } } }, dev.req)) as any).ok, true);
});

test('FieldsService caches per org and clears on writes', async () => {
  const { fields } = setup({ roles: ['developer'] });
  const first = await fields.resolved('org-1', 'basicdata');
  assert.equal(await fields.resolved('org-1', 'basicdata'), first, 'second read is cached');
  fields.invalidate(null, 'basicdata');
  assert.notEqual(await fields.resolved('org-1', 'basicdata'), first, 'a global write clears every org');
});

test('FieldsController.designAccess', async () => {
  const dev = setup({ roles: ['member', 'developer'] });
  assert.deepEqual(await dev.controller.designAccess('org-1', dev.req), { ok: true, canDesign: true, canEditGlobal: false });
  const superDev = setup({ roles: [], superdeveloper: true });
  assert.deepEqual(await superDev.controller.designAccess('org-1', superDev.req), { ok: true, canDesign: true, canEditGlobal: true });
  const member = setup({ roles: ['admin'] });
  assert.deepEqual(await member.controller.designAccess('org-1', member.req), { ok: true, canDesign: false, canEditGlobal: false });
});

// ---------------------------------------------------------------------------
// Custom fields (defined by a template, stored as JSON keys)
// ---------------------------------------------------------------------------

const placeOfBirth = { type: 'text', group: 'personalien', order: 75, caption: { en: 'Place of birth', de: 'Geburtsort' } } as const;

test('mergeForm adds custom fields from each layer; the org may override a global one', () => {
  const form = mergeForm(
    BASICDATA_FORM,
    { fields: {}, custom: { placeOfBirth } },
    { fields: { placeOfBirth: { required: true } }, custom: { shoeSize: { type: 'number', group: 'personalien', caption: { en: 'Shoe size' } }, oldOne: { type: 'text', group: 'address', caption: { en: 'Old' }, retired: true } } },
  );
  const pob = form.fields.find((f) => f.key === 'placeOfBirth')!;
  assert.equal(pob.custom, 'global');
  assert.equal(pob.required, true);
  assert.equal(pob.editableBy, 'hr', 'custom fields are HR-only unless set otherwise');
  assert.deepEqual(pob.texts.caption, { en: 'Place of birth', de: 'Geburtsort' });
  assert.deepEqual(pob.storage, { kind: 'json', table: 'users', column: 'basicdata', key: 'placeOfBirth' });
  assert.equal(form.fields.find((f) => f.key === 'shoeSize')!.custom, 'org');
  assert.equal(form.fields.find((f) => f.key === 'oldOne')!.retired, true);
  assert.deepEqual(orgCustomKeys(form), ['shoeSize', 'oldOne']);
  assert.ok(!editableKeys(form, 'hr').includes('oldOne'), 'retired fields are not writable');
  assert.ok(editableKeys(form, 'hr').includes('shoeSize'));
  assert.ok(!editableKeys(form, 'self').includes('shoeSize'));
});

test('checkCustomKey: format, code fields, reserved and taken keys', () => {
  assert.deepEqual(checkCustomKey(BASICDATA_FORM, 'placeOfBirth', []), { ok: true });
  assert.deepEqual(checkCustomKey(BASICDATA_FORM, 'Place', []), { ok: false, reason: 'bad-key' });
  assert.deepEqual(checkCustomKey(BASICDATA_FORM, 'place-of-birth', []), { ok: false, reason: 'bad-key' });
  assert.deepEqual(checkCustomKey(BASICDATA_FORM, 'street', []), { ok: false, reason: 'key-taken' });
  assert.deepEqual(checkCustomKey(BASICDATA_FORM, 'children', []), { ok: false, reason: 'key-taken' });
  assert.deepEqual(checkCustomKey(BASICDATA_FORM, 'orgs', []), { ok: false, reason: 'key-taken' });
  assert.deepEqual(checkCustomKey(BASICDATA_FORM, 'placeOfBirth', ['placeOfBirth']), { ok: false, reason: 'key-taken' });
});

test('checkCustomField: needs a type, an English caption and a section; type changes keep values readable', () => {
  const ok = checkCustomField(BASICDATA_FORM, 'placeOfBirth', placeOfBirth);
  assert.deepEqual(ok, { ok: true, value: { ...placeOfBirth, editableBy: 'hr' } });
  assert.deepEqual(checkCustomField(BASICDATA_FORM, 'x', { ...placeOfBirth, caption: { de: 'Nur Deutsch' } }), { ok: false, reason: 'caption-missing', property: 'caption' });
  assert.deepEqual(checkCustomField(BASICDATA_FORM, 'x', { ...placeOfBirth, type: 'select' }), { ok: false, reason: 'invalid-value', property: 'type' });
  assert.deepEqual(checkCustomField(BASICDATA_FORM, 'x', { ...placeOfBirth, group: undefined }), { ok: false, reason: 'unknown-group', property: 'group' });
  assert.equal(checkCustomField(BASICDATA_FORM, 'x', { ...placeOfBirth, editableBy: 'self' }).ok, true);
  assert.deepEqual(checkCustomField(EXPENSE_FORM, 'x', { ...placeOfBirth, group: 'expense', editableBy: 'self' }), { ok: false, reason: 'invalid-value', property: 'editableBy' });
  assert.equal(checkCustomField(BASICDATA_FORM, 'x', { ...placeOfBirth, type: 'datetime' }, { ...placeOfBirth, type: 'date' }).ok, true);
  assert.deepEqual(checkCustomField(BASICDATA_FORM, 'x', { ...placeOfBirth, type: 'number' }, placeOfBirth), { ok: false, reason: 'type-not-allowed', property: 'type' });
  assert.deepEqual(checkCustomField(BASICDATA_FORM, 'x', { ...placeOfBirth, hidden: 'yes' }), { ok: false, reason: 'invalid-value', property: 'hidden' });
});

/** The parameters of the last INSERT INTO field_config: org, form, key, is_custom, config JSON. */
function lastInsert(stored: any[]): { orgId: unknown; key: unknown; isCustom: unknown; config: any } {
  const [orgId, , key, isCustom, json] = stored.at(-1);
  return { orgId, key, isCustom, config: JSON.parse(json) };
}

test('FieldsController: an org developer adds a custom field; its key must be free', async () => {
  const dev = setup({ roles: ['developer'] });
  const res: any = await dev.controller.putOrg('org-1', 'basicdata', 'placeOfBirth', { config: placeOfBirth, custom: true }, dev.req);
  assert.equal(res.ok, true);
  assert.deepEqual(lastInsert(dev.stored), { orgId: 'org-1', key: 'placeOfBirth', isCustom: true, config: { ...placeOfBirth, editableBy: 'hr' } });

  const globalTaken = setup({ roles: ['developer'], rows: [{ organization_id: null, field_key: 'placeOfBirth', is_custom: true, config: placeOfBirth }] });
  assert.deepEqual(await globalTaken.controller.putOrg('org-1', 'basicdata', 'placeOfBirth', { config: placeOfBirth, custom: true }, globalTaken.req), {
    ok: false,
    error: 'field-config-invalid',
    reason: 'key-taken',
    property: 'key',
  });
  // …but the org may override that global custom field, like a code field.
  const override: any = await globalTaken.controller.putOrg('org-1', 'basicdata', 'placeOfBirth', { config: { required: true } }, globalTaken.req);
  assert.equal(override.ok, true);
  assert.equal(lastInsert(globalTaken.stored).isCustom, false);

  const superdev = setup({ superdeveloper: true, orgCustomKeyTaken: true });
  const global: any = await superdev.controller.putGlobal('basicdata', 'placeOfBirth', { config: placeOfBirth, custom: true }, superdev.req);
  assert.equal(global.reason, 'key-taken', 'a global key may not collide with any org custom field');
});

test('FieldsController: deleting a custom field retires it', async () => {
  const dev = setup({ roles: ['developer'], rows: [{ organization_id: 'org-1', field_key: 'placeOfBirth', is_custom: true, config: placeOfBirth }] });
  assert.equal(((await dev.controller.deleteOrg('org-1', 'basicdata', 'placeOfBirth', dev.req)) as any).ok, true);
  assert.deepEqual(dev.writes, ['insert'], 'kept, not deleted');
  assert.equal(lastInsert(dev.stored).config.retired, true);
  // A saved custom field is edited with plain PUTs; an incompatible type change is refused.
  const changed: any = await dev.controller.putOrg('org-1', 'basicdata', 'placeOfBirth', { config: { ...placeOfBirth, type: 'number' } }, dev.req);
  assert.equal(changed.reason, 'type-not-allowed');
});

test('basic data: org custom fields live in the org section, and each org sees only its own', () => {
  assert.deepEqual(nestOrgKeys({ street: 'A', shoeSize: 42 }, ['shoeSize'], 'org-1'), { street: 'A', orgs: { 'org-1': { shoeSize: 42 } } });
  assert.deepEqual(nestOrgKeys({ street: 'A' }, ['shoeSize'], 'org-1'), { street: 'A' });
  const stored = { street: 'A', placeOfBirth: 'Bern', orgs: { 'org-1': { shoeSize: 42 }, 'org-2': { secret: 'x' } } };
  assert.deepEqual(scopeToOrg(stored, 'org-1'), { street: 'A', placeOfBirth: 'Bern', shoeSize: 42 });
  assert.deepEqual(scopeToOrg(stored, 'org-3'), { street: 'A', placeOfBirth: 'Bern' });
  assert.deepEqual(keepOrgSection(stored, 'org-2'), { street: 'A', placeOfBirth: 'Bern', orgs: { 'org-2': { secret: 'x' } } });

  const form = mergeForm(BASICDATA_FORM, undefined, { fields: {}, custom: { shoeSize: { type: 'number', group: 'personalien', caption: { en: 'Shoe size' }, editableBy: 'self' } } });
  assert.ok(allowedKeys(form, 'self').includes('shoeSize'));
  assert.ok(allowedKeys(form, 'self').includes('bankAccounts'));
});
