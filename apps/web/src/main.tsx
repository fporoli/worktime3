import React from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import { I18nProvider } from './i18n';
import theme from './theme';
import { DatePickerLocalization } from './ConfigField';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <I18nProvider>
        <DatePickerLocalization>
          <App />
        </DatePickerLocalization>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
