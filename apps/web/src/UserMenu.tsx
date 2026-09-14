import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import type { Session } from './Login';
import { LOCALES, useT, type Locale } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface UserMenuProps {
  session: Session;
  authHeaders: () => Promise<Record<string, string>>;
  onLogout: () => void;
  /** Called once the language change is saved, so the caller can update the session. */
  onLocaleChange: (locale: Locale) => void;
  /** Called once other settings (e.g. worktime ranges) are saved, so the caller can update the session. */
  onSettingsChange: (settings: NonNullable<Session['settings']>) => void;
}

export default function UserMenu({ session, authHeaders, onLogout, onLocaleChange, onSettingsChange }: UserMenuProps) {
  const t = useT();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState<Locale>((session.locale as Locale) ?? 'en');
  const [useWorktimeRanges, setUseWorktimeRanges] = useState(session.settings?.useWorktimeMinutesRanges === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSettings() {
    setSelectedLocale((session.locale as Locale) ?? 'en');
    setUseWorktimeRanges(session.settings?.useWorktimeMinutesRanges === true);
    setError(null);
    setSettingsOpen(true);
    setAnchorEl(null);
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    const settings = { ...session.settings, useWorktimeMinutesRanges: useWorktimeRanges };
    try {
      const res = await fetch(`${API}/users/${session.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ locale: selectedLocale, settings }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(`Could not save (${data.error ?? 'unknown error'}).`);
        return;
      }
      onLocaleChange(selectedLocale);
      onSettingsChange(settings);
      setSettingsOpen(false);
    } catch {
      setError('Could not reach the API.');
    } finally {
      setSaving(false);
    }
  }

  const initial = (session.displayName || session.email || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <Button
        color="inherit"
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ textTransform: 'none', gap: 1 }}
        aria-haspopup="menu"
        aria-expanded={!!anchorEl}
      >
        <Avatar sx={{ width: 24, height: 24, fontSize: 13, bgcolor: 'primary.dark' }}>{initial}</Avatar>
        <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
          {session.displayName}
        </Typography>
        <Box component="span" aria-hidden sx={{ fontSize: 10, opacity: 0.8 }}>▾</Box>
      </Button>

      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <Box sx={{ px: 2, py: 1, minWidth: 200 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{session.displayName}</Typography>
          <Typography variant="caption" color="text.secondary">{session.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={openSettings}>{t('usermenu.settings')}</MenuItem>
        <MenuItem onClick={() => { setAnchorEl(null); onLogout(); }}>{t('usermenu.logout')}</MenuItem>
      </Menu>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('usermenu.settings')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <TextField
            select
            label={t('usermenu.language')}
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value as Locale)}
            size="small"
            sx={{ mt: 1 }}
          >
            {LOCALES.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={useWorktimeRanges} onChange={(e) => setUseWorktimeRanges(e.target.checked)} />}
            label={t('usermenu.useWorktimeRanges')}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            {t('usermenu.useWorktimeRangesHint')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>{t('usermenu.cancel')}</Button>
          <Button variant="contained" onClick={saveSettings} disabled={saving}>{t('usermenu.save')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
