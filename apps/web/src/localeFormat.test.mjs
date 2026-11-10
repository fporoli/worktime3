import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDurationMinutes,
  formatFileSize,
  formatLocaleDate,
  formatLocaleNumber,
  formatSignedMinutes,
  parseLocaleNumber,
} from './localeFormat.ts';

test('empty input is null, garbage is undefined', () => {
  assert.equal(parseLocaleNumber('', 'de'), null);
  assert.equal(parseLocaleNumber('   ', 'en'), null);
  assert.equal(parseLocaleNumber('abc', 'en'), undefined);
  assert.equal(parseLocaleNumber('12,5,3.1x', 'en'), undefined);
  assert.equal(parseLocaleNumber('1-2', 'en'), undefined);
});

test('plain integers and negatives', () => {
  assert.equal(parseLocaleNumber('42', 'it'), 42);
  assert.equal(parseLocaleNumber('-7', 'fr'), -7);
});

test('a single separator with 1 or 2 decimals is the decimal separator in every language', () => {
  for (const locale of ['en', 'de', 'fr', 'it']) {
    assert.equal(parseLocaleNumber('12.50', locale), 12.5, `${locale} 12.50`);
    assert.equal(parseLocaleNumber('12,50', locale), 12.5, `${locale} 12,50`);
    assert.equal(parseLocaleNumber('0,5', locale), 0.5, `${locale} 0,5`);
  }
});

test("three digits after the locale's grouping separator mean thousands", () => {
  assert.equal(parseLocaleNumber('1.234', 'de'), 1234);
  assert.equal(parseLocaleNumber('1.234', 'it'), 1234);
  assert.equal(parseLocaleNumber('1,234', 'en'), 1234);
  // ...but not when it is the locale's decimal separator
  assert.equal(parseLocaleNumber('1,234', 'de'), 1.234);
  assert.equal(parseLocaleNumber('1.234', 'en'), 1.234);
});

test('both separators: the last one is decimal', () => {
  assert.equal(parseLocaleNumber('1.234,56', 'de'), 1234.56);
  assert.equal(parseLocaleNumber('1,234.56', 'de'), 1234.56);
  assert.equal(parseLocaleNumber('1,234,567.8', 'en'), 1234567.8);
});

test('spaces and apostrophes are grouping', () => {
  assert.equal(parseLocaleNumber("1'234.50", 'de'), 1234.5);
  assert.equal(parseLocaleNumber('1’234.50', 'de'), 1234.5);
  assert.equal(parseLocaleNumber('1 234,5', 'fr'), 1234.5);
  assert.equal(parseLocaleNumber('1 234,5', 'fr'), 1234.5);
});

test('formatting round-trips through parsing', () => {
  for (const locale of ['en', 'de', 'fr', 'it']) {
    for (const n of [0, 12.5, 1234.56, -9876543.21]) {
      assert.equal(parseLocaleNumber(formatLocaleNumber(n, locale), locale), n, `${locale} ${n}`);
    }
  }
});

test('dates are shown in the language, without shifting the day', () => {
  assert.equal(formatLocaleDate('2026-03-01', 'de'), '1.3.2026');
  assert.equal(formatLocaleDate('2026-03-01', 'en'), '3/1/2026');
  assert.equal(formatLocaleDate('2026-03-01', 'fr'), '01/03/2026');
  assert.equal(formatLocaleDate('not a date', 'de'), 'not a date');
});

test('duration and file size formatting helpers', () => {
  assert.equal(formatDurationMinutes(0), '0h 00m');
  assert.equal(formatDurationMinutes(65), '1h 05m');
  assert.equal(formatSignedMinutes(90), '+1h 30m');
  assert.equal(formatSignedMinutes(-65), '-1h 05m');
  assert.equal(formatFileSize(512, 'en'), '512 B');
  assert.equal(formatFileSize(1536, 'en'), '1.5 KB');
});
