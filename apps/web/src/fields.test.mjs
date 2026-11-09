import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASICDATA_FORM, FORMS, writableKeys } from '@worktime3/shared/fields';
import { DICTIONARIES } from './dictionaries.ts';

test('every caption, tooltip, placeholder and group title in the field registry has a text', () => {
  const missing = [];
  for (const form of Object.values(FORMS)) {
    for (const g of form.groups) if (!(g.caption in DICTIONARIES.en)) missing.push(`${form.id}.${g.key}: ${g.caption}`);
    for (const f of form.fields) {
      for (const key of [f.caption, f.tooltip, f.placeholder]) {
        if (key && !(key in DICTIONARIES.en)) missing.push(`${form.id}.${f.key}: ${key}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

// The basic-data sections must keep saving exactly the keys the API accepts for them
// (ADMIN_ONLY_KEYS / SELF_SERVICE_KEYS in apps/api/src/basicdata.controller.ts).
test('basic-data sections save the same keys as before the move to the registry', () => {
  assert.deepEqual(writableKeys(BASICDATA_FORM, 'personalien'), [
    'displayName', 'firstName', 'middleName', 'lastName', 'personnelNumber', 'gender', 'birthDate',
    'socialSecurityNumber', 'languageCode', 'placeOfOrigin', 'nationality', 'residencePermitCode',
  ]);
  assert.deepEqual(writableKeys(BASICDATA_FORM, 'address'), [
    'salutation', 'street', 'postalCode', 'city', 'country', 'canton', 'phone1', 'phone2', 'mobile', 'email',
  ]);
  assert.deepEqual(writableKeys(BASICDATA_FORM, 'civilStatus'), ['civilStatus', 'civilStatusSince']);
});
