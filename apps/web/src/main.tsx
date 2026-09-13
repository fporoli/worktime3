import React from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import App from './App';
import { I18nProvider } from './i18n';

const theme = createTheme({ palette: { mode: 'light', primary: { main: '#1a73e8' } } });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
