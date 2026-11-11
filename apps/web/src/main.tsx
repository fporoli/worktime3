import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import { I18nProvider } from './i18n';
import { BrandingContext, createAppTheme, ThemeModeContext, type ThemeMode } from './theme';
import type { OrgBranding } from '@worktime3/shared/branding';
import { DatePickerLocalization } from './ConfigField';

const THEME_STORAGE_KEY = 'worktime.themeMode';

function loadThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* private-browsing etc. */ }
  return 'light';
}

function Root() {
  const [mode, setMode] = useState<ThemeMode>(loadThemeMode);
  const [branding, setBranding] = useState<OrgBranding>({});
  const theme = useMemo(() => createAppTheme(mode, branding), [mode, branding]);
  const brandingCtx = useMemo(() => ({ branding, setBranding }), [branding]);
  const ctx = useMemo(
    () => ({
      mode,
      toggleMode: () => {
        setMode((prev) => {
          const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
          try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
          } catch { /* ignore */ }
          return next;
        });
      },
    }),
    [mode],
  );

  return (
    <ThemeModeContext.Provider value={ctx}>
      <BrandingContext.Provider value={brandingCtx}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <I18nProvider>
            <DatePickerLocalization>
              <App />
            </DatePickerLocalization>
          </I18nProvider>
        </ThemeProvider>
      </BrandingContext.Provider>
    </ThemeModeContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
