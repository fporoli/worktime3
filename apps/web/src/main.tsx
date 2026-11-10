import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import { I18nProvider } from './i18n';
import { createAppTheme, ThemeModeContext, type ThemeMode } from './theme';
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
  const theme = useMemo(() => createAppTheme(mode), [mode]);
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
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <I18nProvider>
          <DatePickerLocalization>
            <App />
          </DatePickerLocalization>
        </I18nProvider>
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
