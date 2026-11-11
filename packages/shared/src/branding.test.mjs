import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LOGO_DATA_URL_LENGTH,
  contrastTextColor,
  isDarkColor,
  isHexColor,
  isLogoDataUrl,
  parseBranding,
  validateBranding,
} from './branding.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('isHexColor accepts only #rrggbb', () => {
  assert.equal(isHexColor('#1a56db'), true);
  assert.equal(isHexColor('#1A56DB'), true);
  for (const bad of ['1a56db', '#fff', '#1a56dbff', 'red', 'rgb(0,0,0)', '', null, 42]) assert.equal(isHexColor(bad), false, String(bad));
});

test('isLogoDataUrl accepts base64 images of the allowed types only', () => {
  assert.equal(isLogoDataUrl(PNG), true);
  assert.equal(isLogoDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), true);
  assert.equal(isLogoDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isLogoDataUrl('data:image/svg+xml;utf8,<svg/>'), false);
  assert.equal(isLogoDataUrl('https://example.com/logo.png'), false);
  assert.equal(isLogoDataUrl('data:image/png;base64,abc"onerror="x'), false);
});

test('validateBranding normalizes colors and treats empty values as defaults', () => {
  const r = validateBranding({ headerColor: '#AABBCC', backgroundColor: '', sidebarColor: null, logo: PNG, extra: 'ignored' });
  assert.deepEqual(r, { ok: true, branding: { headerColor: '#aabbcc', logo: PNG } });
  assert.deepEqual(validateBranding(undefined), { ok: true, branding: {} });
});

test('validateBranding refuses invalid values', () => {
  assert.deepEqual(validateBranding({ headerColor: 'blue' }), { ok: false, error: 'invalid-color' });
  assert.deepEqual(validateBranding({ logo: 'https://x/y.png' }), { ok: false, error: 'invalid-logo' });
  const big = 'data:image/png;base64,' + 'A'.repeat(MAX_LOGO_DATA_URL_LENGTH);
  assert.deepEqual(validateBranding({ logo: big }), { ok: false, error: 'logo-too-large' });
});

test('parseBranding keeps only valid stored fields', () => {
  assert.deepEqual(parseBranding({ headerColor: '#123456', sidebarColor: 'nope', logo: 'x' }), { headerColor: '#123456' });
  assert.deepEqual(parseBranding(null), {});
  assert.deepEqual(parseBranding('x'), {});
});

test('contrastTextColor picks light text on dark backgrounds', () => {
  assert.equal(isDarkColor('#000000'), true);
  assert.equal(isDarkColor('#ffffff'), false);
  assert.equal(contrastTextColor('#1a56db'), '#ffffff');
  assert.equal(contrastTextColor('#fde68a'), '#1a1f36');
});
