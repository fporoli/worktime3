import { createContext, useContext } from 'react';
import { alpha, createTheme, darken } from '@mui/material';
import { contrastTextColor, isDarkColor, type OrgBranding } from '@worktime3/shared/branding';

export type ThemeMode = 'light' | 'dark';

export const ThemeModeContext = createContext<{ mode: ThemeMode; toggleMode: () => void }>({
  mode: 'light',
  toggleMode: () => {},
});

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

/**
 * The current organization's look and feel. App.tsx sets it when the organization changes
 * (GET organizations/:id/branding); main.tsx rebuilds the theme from it.
 */
export const BrandingContext = createContext<{ branding: OrgBranding; setBranding: (b: OrgBranding) => void }>({
  branding: {},
  setBranding: () => {},
});

export function useBranding() {
  return useContext(BrandingContext);
}

const primaryLight = { main: '#1a56db', light: '#4c7bea', dark: '#0f3fa8', contrastText: '#ffffff' };
const primaryDark = { main: '#4c7bea', light: '#7da2f2', dark: '#1a56db', contrastText: '#ffffff' };

/** The light theme's colors that an organization's branding can replace. */
export const DEFAULT_BRANDING_COLORS = { headerColor: primaryLight.main, backgroundColor: '#f5f6fa', sidebarColor: '#fbfbfd' } as const;

/**
 * App theme for a mode, with an organization's branding on top. The header color applies in
 * both modes; page and sidebar colors only in light mode, where the app's text is dark.
 */
export function createAppTheme(mode: ThemeMode = 'light', branding: OrgBranding = {}) {
  const isDark = mode === 'dark';
  const primary = isDark ? primaryDark : primaryLight;
  const dividerColor = isDark ? '#2d3748' : '#e4e7ed';
  const header = branding.headerColor;
  const pageBackground = !isDark ? branding.backgroundColor : undefined;
  const sidebar = !isDark ? branding.sidebarColor : undefined;
  const sidebarText = sidebar && isDarkColor(sidebar) ? contrastTextColor(sidebar) : undefined;

  return createTheme({
    palette: {
      mode,
      primary,
      background: isDark
        ? { default: '#0b1120', paper: '#111827' }
        : { default: pageBackground ?? DEFAULT_BRANDING_COLORS.backgroundColor, paper: '#ffffff' },
      text: isDark
        ? { primary: '#f1f5f9', secondary: '#94a3b8' }
        : { primary: '#1a1f36', secondary: '#5b6474' },
      divider: dividerColor,
    },
    shape: {
      borderRadius: 10,
    },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      h4: { fontWeight: 700, letterSpacing: '-0.01em' },
      h5: { fontWeight: 700, letterSpacing: '-0.01em' },
      h6: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 8, paddingInline: 16 },
          contained: {
            '&:hover': { boxShadow: '0 1px 2px rgba(16,24,40,0.18)' },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: header
              ? `linear-gradient(135deg, ${header} 0%, ${darken(header, 0.2)} 100%)`
              : isDark
                ? 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)'
                : `linear-gradient(135deg, ${primaryLight.main} 0%, ${primaryLight.dark} 100%)`,
            ...(header ? { backgroundColor: header, color: contrastTextColor(header) } : {}),
            borderBottom: isDark ? `1px solid ${dividerColor}` : 'none',
            boxShadow: isDark
              ? '0 1px 3px rgba(0,0,0,0.35)'
              : '0 1px 2px rgba(16,24,40,0.08), 0 4px 12px rgba(16,24,40,0.10)',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: sidebar ?? (isDark ? '#0f172a' : DEFAULT_BRANDING_COLORS.sidebarColor),
            borderRight: `1px solid ${dividerColor}`,
            // A dark sidebar color gets light text, including group headers and the selected item.
            ...(sidebarText
              ? {
                  color: sidebarText,
                  '& .MuiListSubheader-root': { color: alpha(sidebarText, 0.7) },
                  '& .MuiDivider-root': { borderColor: alpha(sidebarText, 0.2) },
                  '& .MuiListItemButton-root.Mui-selected': { color: sidebarText, backgroundColor: alpha(sidebarText, 0.16) },
                  '& .MuiListItemButton-root:hover': { backgroundColor: alpha(sidebarText, 0.1) },
                }
              : {}),
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          outlined: { borderColor: dividerColor },
          elevation1: {
            border: isDark ? `1px solid ${dividerColor}` : 'none',
            boxShadow: isDark
              ? '0 1px 3px rgba(0,0,0,0.28)'
              : '0 1px 2px rgba(16,24,40,0.04), 0 1px 6px rgba(16,24,40,0.06)',
          },
          elevation2: {
            border: isDark ? `1px solid ${dividerColor}` : 'none',
            boxShadow: isDark
              ? '0 4px 16px rgba(0,0,0,0.45)'
              : '0 1px 3px rgba(16,24,40,0.06), 0 4px 12px rgba(16,24,40,0.08)',
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { height: 3, borderRadius: 3 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, minHeight: 44 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 700,
            fontSize: '0.75rem',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: isDark ? '#94a3b8' : '#5b6474',
            backgroundColor: isDark ? '#162032' : '#f8f9fc',
            borderBottom: `1px solid ${dividerColor}`,
            whiteSpace: 'nowrap',
          },
          root: {
            borderBottom: `1px solid ${isDark ? '#1e293b' : '#eef0f4'}`,
            fontVariantNumeric: 'tabular-nums',
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            border: `1px solid ${isDark ? '#1e293b' : '#eef0f4'}`,
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&:hover': { backgroundColor: alpha(primary.main, isDark ? 0.08 : 0.04) },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 8 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            marginLeft: 8,
            marginRight: 8,
            width: 'auto',
            '&.Mui-selected': {
              backgroundColor: alpha(primary.main, isDark ? 0.18 : 0.1),
              color: primary.main,
              fontWeight: 600,
              '&:hover': { backgroundColor: alpha(primary.main, isDark ? 0.24 : 0.14) },
            },
          },
        },
      },
    },
  });
}

export default createAppTheme('light');
