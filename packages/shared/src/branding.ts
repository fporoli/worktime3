// Organization look and feel: colors and a logo an admin picks for their organization.
// Stored in `organizations.settings.branding`, served by GET/PUT organizations/:id/branding,
// applied by the web app's theme (theme.ts). The API and the browser validate with the same
// functions below.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

export interface OrgBranding {
  /** App bar (top header) background. */
  headerColor?: string;
  /** Page background behind the content cards (light mode only). */
  backgroundColor?: string;
  /** Navigation sidebar background (light mode only). */
  sidebarColor?: string;
  /** Logo shown in the app bar: a `data:image/...;base64,` URL. */
  logo?: string;
}

export const BRANDING_COLOR_KEYS = ['headerColor', 'backgroundColor', 'sidebarColor'] as const;
export type BrandingColorKey = (typeof BRANDING_COLOR_KEYS)[number];

/**
 * Longest accepted logo data URL, in characters. Stays under the API's default 100 KB JSON
 * body limit; the web app scales raster images down to logo size before upload, so a photo
 * still fits.
 */
export const MAX_LOGO_DATA_URL_LENGTH = 90_000;

export const LOGO_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** A base64 data URL of an accepted image type (length is checked separately). */
export function isLogoDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = /^data:([a-z+/]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  return !!m && LOGO_MIME_TYPES.includes(m[1]);
}

/** Reads stored branding leniently: keeps the valid fields, drops anything else. */
export function parseBranding(raw: unknown): OrgBranding {
  const out: OrgBranding = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of BRANDING_COLOR_KEYS) if (isHexColor(r[key])) out[key] = (r[key] as string).toLowerCase();
  if (isLogoDataUrl(r.logo) && r.logo.length <= MAX_LOGO_DATA_URL_LENGTH) out.logo = r.logo;
  return out;
}

export type BrandingResult = { ok: true; branding: OrgBranding } | { ok: false; error: 'invalid-color' | 'invalid-logo' | 'logo-too-large' };

/**
 * Validates a full branding object to save. Missing, null and empty-string fields mean
 * "use the default"; anything else must be valid or the whole save is refused.
 */
export function validateBranding(input: unknown): BrandingResult {
  const r = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const branding: OrgBranding = {};
  for (const key of BRANDING_COLOR_KEYS) {
    const v = r[key];
    if (v === undefined || v === null || v === '') continue;
    if (!isHexColor(v)) return { ok: false, error: 'invalid-color' };
    branding[key] = v.toLowerCase();
  }
  const logo = r.logo;
  if (logo !== undefined && logo !== null && logo !== '') {
    if (!isLogoDataUrl(logo)) return { ok: false, error: 'invalid-logo' };
    if (logo.length > MAX_LOGO_DATA_URL_LENGTH) return { ok: false, error: 'logo-too-large' };
    branding.logo = logo;
  }
  return { ok: true, branding };
}

/** WCAG relative luminance of a `#rrggbb` color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** True when text on this background should be light. */
export function isDarkColor(hex: string): boolean {
  // Crossover where white and near-black text have equal contrast.
  return relativeLuminance(hex) < 0.179;
}

/** Readable text color for a background: white on dark colors, the app's dark text otherwise. */
export function contrastTextColor(hex: string): string {
  return isDarkColor(hex) ? '#ffffff' : '#1a1f36';
}
