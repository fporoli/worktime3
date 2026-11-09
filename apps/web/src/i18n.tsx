import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { DICTIONARIES, type Locale } from './dictionaries';

export type { Locale };

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
];

const LOCALE_STORAGE_KEY = 'worktime.locale';

function isLocale(value: string | undefined | null): value is Locale {
  return !!value && LOCALES.some((l) => l.code === value);
}

/** Best-effort starting locale, before we know the signed-in user's saved preference (if any). */
function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch { /* private-browsing etc. */ }
  const browser = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : undefined;
  return isLocale(browser) ? browser : 'en';
}

type Vars = Record<string, string | number>;

/** The translator returned by `useT()`; pass it to plain helper functions that build UI text. */
export type TFunction = (key: string, vars?: Vars) => string;


interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());

  function setLocale(next: Locale) {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch { /* private-browsing etc. */ }
  }

  const t = useMemo(() => {
    return (key: string, vars?: Vars) => {
      const template = DICTIONARIES[locale]?.[key] ?? DICTIONARIES.en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''));
    };
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Convenience for components that only need the translator function. */
export function useT() {
  return useI18n().t;
}
