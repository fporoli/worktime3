import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES } from './dictionaries.ts';

const reference = DICTIONARIES.en;
const others = Object.keys(DICTIONARIES).filter((l) => l !== 'en');
const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

for (const locale of others) {
  const dict = DICTIONARIES[locale];

  test(`${locale} has every English key`, () => {
    const missing = Object.keys(reference).filter((k) => !(k in dict));
    assert.deepEqual(missing, [], `missing in ${locale}`);
  });

  test(`${locale} has no keys English lacks`, () => {
    const extra = Object.keys(dict).filter((k) => !(k in reference));
    assert.deepEqual(extra, [], `only in ${locale}`);
  });

  test(`${locale} uses the same {{placeholders}} as English`, () => {
    const mismatched = Object.keys(reference)
      .filter((k) => k in dict)
      .filter((k) => placeholders(reference[k]).join() !== placeholders(dict[k]).join());
    assert.deepEqual(mismatched, [], `placeholder mismatch in ${locale}`);
  });
}

test('no text is empty', () => {
  const empty = Object.entries(DICTIONARIES).flatMap(([locale, dict]) =>
    Object.entries(dict).filter(([, v]) => !v.trim()).map(([k]) => `${locale}:${k}`),
  );
  assert.deepEqual(empty, []);
});
