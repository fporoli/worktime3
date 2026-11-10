/** Seed payloads for the global (`organization_id = NULL`) `static_data` rows (entity="users")
 * that back the "Meine Daten" dropdowns — language code, nationality, and address country. Kept in
 * sync with 034-static-data-nullable-org.sql and infra/postgres/seeds/seed.sql. */

const UI_LOCALES = ['en', 'de', 'fr', 'it'] as const;
type UiLocale = (typeof UI_LOCALES)[number];

/** Languages corresponding to Switzerland, its neighbours (DE, FR, IT, AT, LI), and ES, PT, GB, US, CZ, SK, PL. */
export const LANGUAGE_CODES = ['de', 'fr', 'it', 'rm', 'en', 'es', 'pt', 'cs', 'sk', 'pl'] as const;

/** Switzerland + neighbouring countries (DE, FR, IT, AT, LI) + ES, PT, GB (UK), US, CZ, SK, PL (PO). */
export const COUNTRY_CODES = [
  'CH',
  'DE',
  'FR',
  'IT',
  'AT',
  'LI',
  'ES',
  'PT',
  'GB',
  'US',
  'CZ',
  'SK',
  'PL',
] as const;

const NATIVE_LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  rm: 'Rumantsch',
};

const OTHER_LABELS: Record<UiLocale, string> = {
  en: 'Others',
  de: 'Andere',
  fr: 'Autres',
  it: 'Altri',
};

function capitalizeFirst(label: string, locale: string): string {
  if (!label) return label;
  return label[0].toLocaleUpperCase(locale) + label.slice(1);
}

function buildLocalizedMap(
  codes: readonly string[],
  type: 'language' | 'region',
  locale: UiLocale,
  otherKey: string,
): Record<string, string> {
  const dn = new Intl.DisplayNames([locale], { type });
  const out: Record<string, string> = {};
  for (const code of codes) {
    const raw = dn.of(code) ?? code;
    out[code] = type === 'language' ? capitalizeFirst(raw, locale) : raw;
  }
  out[otherKey] = OTHER_LABELS[locale];
  return out;
}

function buildLocaleStaticData() {
  const translation = Object.fromEntries(
    UI_LOCALES.map((loc) => [loc, buildLocalizedMap(LANGUAGE_CODES, 'language', loc, 'other')]),
  ) as Record<UiLocale, Record<string, string>>;

  const values: Record<string, string> = {};
  for (const code of LANGUAGE_CODES) {
    values[code] = NATIVE_LOCALE_NAMES[code] ?? translation.en[code] ?? code;
  }
  values.other = OTHER_LABELS.en;

  return {
    entity: 'users' as const,
    enum_name: 'locales' as const,
    values,
    translation,
  };
}

function buildCountryStaticData(enumName: 'nations' | 'countries') {
  const translation = Object.fromEntries(
    UI_LOCALES.map((loc) => [loc, buildLocalizedMap(COUNTRY_CODES, 'region', loc, 'OTHER')]),
  ) as Record<UiLocale, Record<string, string>>;

  return {
    entity: 'users' as const,
    enum_name: enumName,
    values: translation.en,
    translation,
  };
}

export const LOCALE_STATIC_DATA = buildLocaleStaticData();
export const NATION_STATIC_DATA = buildCountryStaticData('nations');
export const COUNTRY_STATIC_DATA = buildCountryStaticData('countries');
