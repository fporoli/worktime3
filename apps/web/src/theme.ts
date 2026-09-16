import { alpha, createTheme } from '@mui/material';

// A slightly deeper/richer take on the original flat #1a73e8, so the brand
// color still reads as "blue" but has room for a gradient/hover states
// without looking washed out.
const primary = { main: '#1a56db', light: '#4c7bea', dark: '#0f3fa8', contrastText: '#ffffff' };

const theme = createTheme({
  palette: {
    mode: 'light',
    primary,
    background: {
      // A very light cool gray instead of pure white, so Paper cards read as
      // distinct surfaces via elevation instead of needing a visible border.
      default: '#f5f6fa',
      paper: '#ffffff',
    },
    text: {
      primary: '#1a1f36',
      secondary: '#5b6474',
    },
    divider: '#e4e7ed',
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
          '&:hover': { boxShadow: '0 1px 2px rgba(16,24,40,0.12)' },
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: `linear-gradient(135deg, ${primary.main} 0%, ${primary.dark} 100%)`,
          boxShadow: '0 1px 2px rgba(16,24,40,0.08), 0 4px 12px rgba(16,24,40,0.10)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundColor: '#fbfbfd', borderRight: '1px solid #e4e7ed' },
      },
    },
    // The app's cards are plain `<Paper sx={{ p: 2 }}>` (elevation 1) — replace
    // MUI's default harsh drop-shadow scale with something softer, so they read
    // as lifted surfaces against the page background instead of boxes with a
    // faint outline.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: '#e4e7ed' },
        elevation1: { boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 6px rgba(16,24,40,0.06)' },
        elevation2: { boxShadow: '0 1px 3px rgba(16,24,40,0.06), 0 4px 12px rgba(16,24,40,0.08)' },
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
          color: '#5b6474',
          backgroundColor: '#f8f9fc',
          borderBottom: '1px solid #e4e7ed',
        },
        root: { borderBottom: '1px solid #eef0f4' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: alpha(primary.main, 0.04) },
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
            backgroundColor: alpha(primary.main, 0.1),
            color: primary.main,
            fontWeight: 600,
            '&:hover': { backgroundColor: alpha(primary.main, 0.14) },
          },
        },
      },
    },
  },
});

export default theme;
