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
} from '@worktime3/shared/fields';
import { FieldsController } from '../../apps/api/src/fields.controller';
import { FieldsService } from '../../apps/api/src/fields.service';
import { BASICDATA_HR_KEYS, BASICDATA_SELF_KEYS, BASICDATA_USER_COLUMNS } from '../../apps/api/src/basicdata.controller';
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

test('basic data accepts the same keys as before the registry', () => {
  const adminOnly = ['personnelNumber', 'gender', 'birthDate', 'socialSecurityNumber', 'languageCode', 'placeOfOrigin', 'nationality', 'residencePermitCode', 'displayName', 'firstName', 'middleName', 'lastName'];
  const selfService = ['salutation', 'street', 'postalCode', 'city', 'country', 'canton', 'phone1', 'phone2', 'mobile', 'email', 'bankAccounts', 'emergencyContacts', 'civilStatus', 'civilStatusSince', 'partner', 'children'];
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

function setup(opts: { roles?: string[]; superdeveloper?: boolean; rows?: any[] }) {
  const writes: string[] = [];
  const db = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('FROM user_identities')) return { rows: [{ user_id: 'caller-1' }] };
      if (text.includes('JOIN membership_roles')) return { rows: (opts.roles ?? []).map((name) => ({ name })) };
      if (text.includes('is_superdeveloper')) return { rows: [{ is_superdeveloper: !!opts.superdeveloper }] };
      if (text.includes('SELECT organization_id, field_key, config FROM field_config')) return { rows: opts.rows ?? [] };
      if (text.includes('INSERT INTO field_config')) {
        writes.push('insert');
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
  return { controller, fields, req, writes };
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
