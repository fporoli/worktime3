import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isValidEmail, isValidPassword, parseDemoAccounts, slugBase } from '../../apps/api/src/auth.controller';

test('rejects malformed emails', () => {
  assert.equal(isValidEmail('admin@acme.example'), true);
  assert.equal(isValidEmail('  User@Example.CH  '), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('missing@tld'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(undefined), false);
});

test('requires minimum password length', () => {
  assert.equal(isValidPassword('dev12345'), true);
  assert.equal(isValidPassword('short'), false);
  assert.equal(isValidPassword(''), false);
  assert.equal(isValidPassword(undefined), false);
});

test('derives a clean workspace slug from email', () => {
  assert.equal(slugBase('Ada.Admin@Acme.example'), 'ada-admin');
  assert.equal(slugBase('uli.user@acme.example'), 'uli-user');
});

test('parseDemoAccounts reads JSON-string entries in key order and skips malformed ones', () => {
  const values = {
    '02': '{"name":"Marta (Manager)","user":"marta@acme.com","password":"marta"}',
    '01': '{"name":"Admin (Acme)","user":"admin@acme.com","password":"admin"}',
    '03': 'not json',
    '04': '{"name":"No user","password":"x"}',
    '05': { name: 'Object entry', user: 'obj@acme.com', password: 'obj' },
  };
  assert.deepEqual(parseDemoAccounts(values), [
    { name: 'Admin (Acme)', user: 'admin@acme.com', password: 'admin' },
    { name: 'Marta (Manager)', user: 'marta@acme.com', password: 'marta' },
    { name: 'Object entry', user: 'obj@acme.com', password: 'obj' },
  ]);
  assert.deepEqual(parseDemoAccounts(undefined), []);
  assert.deepEqual(parseDemoAccounts([]), []);
});
