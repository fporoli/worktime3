import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isValidEmail, isValidPassword, slugBase } from './auth.controller';

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
